import ExpoModulesCore
import MapKit
import UIKit

struct Coordinate: Record {
  @Field var latitude: Double = 0
  @Field var longitude: Double = 0
  /**
   * Set when this point is a station (its names, e.g. ["渋谷", "Shibuya"]): the
   * station is then looked up as an Apple place, so a transit ETA ends when the
   * train arrives (not after a walk out to the map point) and a walk ends at
   * the station itself.
   */
  @Field var stationNames: [String] = []

  var location: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: latitude, longitude: longitude) }
}

struct EtaRequest: Record {
  @Field var from: Coordinate = Coordinate()
  @Field var to: Coordinate = Coordinate()
  /** Epoch ms: latest arrival (the last-train query uses e.g. 03:00). */
  @Field var arriveBy: Double? = nil
  /** Epoch ms: earliest departure (first-train query). */
  @Field var departAt: Double? = nil
}

struct SnapshotPin: Record {
  @Field var latitude: Double = 0
  @Field var longitude: Double = 0
  @Field var emphasis: Bool = false
}

struct SnapshotRequest: Record {
  @Field var center: Coordinate = Coordinate()
  /** Vertical extent of the map in metres. */
  @Field var spanMeters: Double = 1200
  @Field var width: Double = 350
  @Field var height: Double = 186
  /** Walking path drawn on the map, in order. */
  @Field var path: [Coordinate] = []
  @Field var pins: [SnapshotPin] = []
  /** Hex colour for the path and emphasised pins. */
  @Field var accent: String = "#F5A93B"
}

/**
 * MapKit for LastRide: transit and walking ETAs, place search, and a static
 * map image for the (non-interactive) map card. Apple's terms require Apple
 * map data to be shown with an Apple map and not cached long-term, so callers
 * request this only for what is on screen and keep nothing past the night.
 */
public class AppleMapsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AppleMaps")

    // MapKit names places in the app's iOS language. Keep that in step with the
    // language chosen in LastRide (iOS's per-app language setting; it takes
    // effect the next time the app starts). Returns whether a restart is needed.
    Function("setPreferredLanguage") { (language: String) -> Bool in
      let current = Locale.preferredLanguages.first ?? ""
      UserDefaults.standard.set([language], forKey: "AppleLanguages")
      return !current.hasPrefix(language)
    }

    AsyncFunction("transitEta") { (request: EtaRequest, promise: Promise) in
      guard Self.isValidPoint(request.from), Self.isValidPoint(request.to),
            request.arriveBy.map({ $0.isFinite }) ?? true,
            request.departAt.map({ $0.isFinite }) ?? true else {
        promise.reject("ERR_COORDINATE", "Invalid transit origin, destination or time")
        return
      }
      self.mapItem(for: request.from) { source, _ in
        self.mapItem(for: request.to) { destination, destinationIsStation in
          let directions = MKDirections(request: self.directionsRequest(request, source: source, destination: destination, transport: .transit))
          directions.calculateETA { response, error in
            guard let eta = response else {
              promise.reject("ERR_ETA", error?.localizedDescription ?? "No transit route")
              return
            }
            promise.resolve([
              "departureMs": eta.expectedDepartureDate.timeIntervalSince1970 * 1000,
              "arrivalMs": eta.expectedArrivalDate.timeIntervalSince1970 * 1000,
              "travelSeconds": eta.expectedTravelTime,
              "distanceMeters": eta.distance,
              // True when the destination was the station place: arrival is then the train's.
              "arrivesAtStation": destinationIsStation,
            ])
          }
        }
      }
    }

    AsyncFunction("walkingRoute") { (from: Coordinate, to: Coordinate, promise: Promise) in
      guard Self.isValidPoint(from), Self.isValidPoint(to) else {
        promise.reject("ERR_COORDINATE", "Invalid walking route coordinates")
        return
      }
      self.mapItem(for: to) { destination, _ in
      let request = MKDirections.Request()
      request.source = MKMapItem(placemark: MKPlacemark(coordinate: from.location))
      request.destination = destination
      request.transportType = .walking
      MKDirections(request: request).calculate { response, error in
        guard let route = response?.routes.first else {
          promise.reject("ERR_WALK", error?.localizedDescription ?? "No walking route")
          return
        }
        let count = route.polyline.pointCount
        var coords = [CLLocationCoordinate2D](repeating: kCLLocationCoordinate2DInvalid, count: count)
        route.polyline.getCoordinates(&coords, range: NSRange(location: 0, length: count))
        // Thin the path: the card only needs its shape.
        let step = max(1, count / 40)
        let path = stride(from: 0, to: count, by: step).map { ["latitude": coords[$0].latitude, "longitude": coords[$0].longitude] }
        promise.resolve([
          "distanceMeters": route.distance,
          "seconds": route.expectedTravelTime,
          "path": path,
        ])
      }
      }
    }

    AsyncFunction("searchPlaces") { (query: String, center: Coordinate, radiusMeters: Double, promise: Promise) in
      guard Self.isValidPoint(center), radiusMeters.isFinite,
            radiusMeters > 0, radiusMeters <= 50_000 else {
        promise.reject("ERR_COORDINATE", "Invalid local search center or radius")
        return
      }
      let request = MKLocalSearch.Request()
      request.naturalLanguageQuery = query
      request.region = MKCoordinateRegion(center: center.location, latitudinalMeters: radiusMeters * 2, longitudinalMeters: radiusMeters * 2)
      request.resultTypes = .pointOfInterest
      MKLocalSearch(request: request).start { response, error in
        guard let items = response?.mapItems else {
          if (error as? MKError)?.code == .placemarkNotFound { promise.resolve([]) } else {
            promise.reject("ERR_SEARCH", error?.localizedDescription ?? "Place search failed")
          }
          return
        }
        promise.resolve(items.map(self.placeDictionary))
      }
    }

    AsyncFunction("nearbyStations") { (center: Coordinate, radiusMeters: Double, promise: Promise) in
      guard Self.isValidPoint(center), radiusMeters.isFinite,
            radiusMeters > 0, radiusMeters <= 50_000 else {
        promise.reject("ERR_COORDINATE", "Invalid station search center or radius")
        return
      }
      let request = MKLocalPointsOfInterestRequest(center: center.location, radius: radiusMeters)
      request.pointOfInterestFilter = MKPointOfInterestFilter(including: [.publicTransport])
      MKLocalSearch(request: request).start { response, error in
        guard let items = response?.mapItems else {
          // "No results" is an error in MapKit; treat it as an empty list.
          if (error as? MKError)?.code == .placemarkNotFound { promise.resolve([]) } else {
            promise.reject("ERR_STATIONS", error?.localizedDescription ?? "Station search failed")
          }
          return
        }
        promise.resolve(items.map(self.placeDictionary))
      }
    }

    AsyncFunction("searchStations") { (query: String, promise: Promise) in
      let request = MKLocalSearch.Request()
      request.naturalLanguageQuery = query
      request.resultTypes = .pointOfInterest
      request.pointOfInterestFilter = MKPointOfInterestFilter(including: [.publicTransport])
      request.region = self.japan
      MKLocalSearch(request: request).start { response, error in
        guard let items = response?.mapItems else {
          if (error as? MKError)?.code == .placemarkNotFound { promise.resolve([]) } else {
            promise.reject("ERR_STATIONS", error?.localizedDescription ?? "Station search failed")
          }
          return
        }
        promise.resolve(items.map(self.placeDictionary))
      }
    }

    AsyncFunction("searchAddresses") { (query: String, promise: Promise) in
      let request = MKLocalSearch.Request()
      request.naturalLanguageQuery = query
      request.resultTypes = .address
      request.region = self.japan
      MKLocalSearch(request: request).start { response, error in
        guard let items = response?.mapItems else {
          if (error as? MKError)?.code == .placemarkNotFound { promise.resolve([]) } else {
            promise.reject("ERR_ADDRESSES", error?.localizedDescription ?? "Address search failed")
          }
          return
        }
        promise.resolve(items.map { item -> [String: Any] in
          var place = self.placeDictionary(item)
          place["label"] = item.placemark.title ?? item.name ?? ""
          return place
        })
      }
    }

    AsyncFunction("drivingEta") { (from: Coordinate, to: Coordinate, promise: Promise) in
      guard Self.isValidPoint(from), Self.isValidPoint(to) else {
        promise.reject("ERR_COORDINATE", "Invalid driving route coordinates")
        return
      }
      let request = MKDirections.Request()
      request.source = MKMapItem(placemark: MKPlacemark(coordinate: from.location))
      request.destination = MKMapItem(placemark: MKPlacemark(coordinate: to.location))
      request.transportType = .automobile
      MKDirections(request: request).calculateETA { response, error in
        guard let eta = response else {
          promise.reject("ERR_DRIVE", error?.localizedDescription ?? "No driving route")
          return
        }
        promise.resolve(["seconds": eta.expectedTravelTime, "distanceMeters": eta.distance])
      }
    }

    AsyncFunction("snapshot") { (request: SnapshotRequest, promise: Promise) in
      let center = request.center.location
      guard CLLocationCoordinate2DIsValid(center),
            request.center.latitude.isFinite, request.center.longitude.isFinite,
            request.spanMeters.isFinite, request.spanMeters > 1, request.spanMeters < 2_000_000,
            request.width.isFinite, request.height.isFinite,
            request.width >= 1, request.width <= 4096,
            request.height >= 1, request.height <= 4096,
            abs(request.center.latitude) <= 85,
            request.spanMeters * request.width / request.height < 2_000_000 else {
        promise.reject("ERR_SNAPSHOT_INPUT", "Invalid map center, dimensions or span")
        return
      }
      let options = MKMapSnapshotter.Options()
      // spanMeters is the vertical extent; the horizontal follows the image's
      // aspect ratio so JS can project coordinates onto the image linearly.
      options.region = MKCoordinateRegion(
        center: request.center.location,
        latitudinalMeters: request.spanMeters,
        longitudinalMeters: request.spanMeters * request.width / max(request.height, 1)
      )
      options.size = CGSize(width: request.width, height: request.height)
      options.traitCollection = UITraitCollection(userInterfaceStyle: .dark)
      options.pointOfInterestFilter = .excludingAll
      MKMapSnapshotter(options: options).start { snapshot, error in
        guard let snapshot = snapshot else {
          promise.reject("ERR_SNAPSHOT", error?.localizedDescription ?? "Snapshot failed")
          return
        }
        let accent = UIColor(hex: request.accent)
        let image = UIGraphicsImageRenderer(size: snapshot.image.size).image { context in
          snapshot.image.draw(at: .zero)
          let cg = context.cgContext
          if request.path.count > 1 {
            cg.setStrokeColor(accent.cgColor)
            cg.setLineWidth(4)
            cg.setLineCap(.round)
            cg.setLineDash(phase: 0, lengths: [2, 9])
            for (index, coordinate) in request.path.enumerated() {
              let point = snapshot.point(for: coordinate.location)
              index == 0 ? cg.move(to: point) : cg.addLine(to: point)
            }
            cg.strokePath()
            cg.setLineDash(phase: 0, lengths: [])
          }
          for pin in request.pins {
            let point = snapshot.point(for: CLLocationCoordinate2D(latitude: pin.latitude, longitude: pin.longitude))
            let radius: CGFloat = pin.emphasis ? 8 : 6
            let rect = CGRect(x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2)
            cg.setFillColor((pin.emphasis ? accent : UIColor.white).cgColor)
            cg.fillEllipse(in: rect)
            cg.setStrokeColor(UIColor(white: 0.05, alpha: 1).cgColor)
            cg.setLineWidth(2)
            cg.strokeEllipse(in: rect)
          }
        }
        // Temporary file for this screen only; the OS clears the caches directory.
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("map-\(UUID().uuidString).png")
        guard let png = image.pngData() else {
          promise.reject("ERR_SNAPSHOT_WRITE", "Could not encode map snapshot as PNG")
          return
        }
        do {
          try png.write(to: url, options: .atomic)
          promise.resolve(url.absoluteString)
        } catch {
          promise.reject("ERR_SNAPSHOT_WRITE", error.localizedDescription)
        }
      }
    }
  }

  /** Reject malformed locations before constructing MKPlacemark/MKLocalSearch.
   * Invalid values can otherwise throw inside platform APIs in release builds. */
  private static func isValidPoint(_ point: Coordinate) -> Bool {
    point.latitude.isFinite && point.longitude.isFinite &&
      abs(point.latitude) <= 85 && CLLocationCoordinate2DIsValid(point.location)
  }

  /** All of Japan, so searches don't drift to same-named places abroad. */
  private var japan: MKCoordinateRegion {
    MKCoordinateRegion(
      center: CLLocationCoordinate2D(latitude: 36.2, longitude: 138.25),
      span: MKCoordinateSpan(latitudeDelta: 22, longitudeDelta: 26)
    )
  }

  private func placeDictionary(_ item: MKMapItem) -> [String: Any] {
    let coordinate = item.placemark.coordinate
    return [
      "name": item.name ?? "",
      "latitude": coordinate.latitude,
      "longitude": coordinate.longitude,
      "phone": item.phoneNumber ?? NSNull(),
      "category": item.pointOfInterestCategory?.rawValue ?? NSNull(),
      "locality": item.placemark.locality ?? NSNull(),
      "administrativeArea": item.placemark.administrativeArea ?? NSNull(),
    ]
  }

  /// Stations already looked up this session, so repeated ETA questions for a
  /// night (the last-train search asks several) cost one search each. Kept in
  /// memory only, never stored (Apple's terms: no long-term caching).
  private var stationItems: [String: MKMapItem?] = [:]
  private let stationItemsLock = NSLock()

  /// The station at `point` as an Apple place when it is named and Apple has a
  /// railway station of that name close by; otherwise the bare map point. The
  /// flag says which. Never guesses: a nearby station with another name (浜松町
  /// next to 大門, a bus terminal "at Tokyo Station") leaves the bare point.
  private func mapItem(for point: Coordinate, completion: @escaping (MKMapItem, Bool) -> Void) {
    let bare = MKMapItem(placemark: MKPlacemark(coordinate: point.location))
    let wanted = point.stationNames.map(Self.baseName).filter { !$0.isEmpty }
    guard !wanted.isEmpty else {
      completion(bare, false)
      return
    }
    let key = String(format: "%@|%.4f|%.4f", wanted.joined(separator: "/"), point.latitude, point.longitude)
    stationItemsLock.lock()
    let cached = stationItems[key]
    stationItemsLock.unlock()
    if let cached {
      completion(cached ?? bare, cached != nil)
      return
    }
    // Nearby places rather than a text search: a search for 東京駅 can rank 横浜駅 first.
    let request = MKLocalPointsOfInterestRequest(center: point.location, radius: Self.stationSearchMeters)
    request.pointOfInterestFilter = MKPointOfInterestFilter(including: [.publicTransport])
    MKLocalSearch(request: request).start { response, _ in
      let here = CLLocation(latitude: point.latitude, longitude: point.longitude)
      // Public transport includes bus stops and taxi ranks: keep railway stations.
      let stations = (response?.mapItems ?? [])
        .filter { Self.isRailwayStation($0.name ?? "") }
        .map { (item: $0, meters: here.distance(from: CLLocation(latitude: $0.placemark.coordinate.latitude, longitude: $0.placemark.coordinate.longitude))) }
        .filter { $0.meters <= Self.stationSearchMeters }
        .sorted { $0.meters < $1.meters }
      let exact = stations.first { wanted.contains(Self.baseName($0.item.name ?? "")) }
      // "Oshiage 'SKYTREE' Station" for 押上 / Oshiage.
      let prefixed = stations.first { candidate in
        let found = Self.baseName(candidate.item.name ?? "")
        return wanted.contains { found.hasPrefix($0) }
      }
      let item = (exact ?? prefixed)?.item
      self.stationItemsLock.lock()
      self.stationItems[key] = item
      self.stationItemsLock.unlock()
      completion(item ?? bare, item != nil)
    }
  }

  private static let stationSearchMeters: Double = 600

  private static func isRailwayStation(_ name: String) -> Bool {
    let trimmed = name.trimmingCharacters(in: .whitespaces).lowercased()
    return trimmed.hasSuffix("駅") || trimmed.hasSuffix("station")
  }

  /// "渋谷駅" / "Ōmiya Station" / "元町・中華街" → "渋谷" / "omiya" / "元町中華街", for matching names.
  private static func baseName(_ name: String) -> String {
    var base = name.folding(options: [.diacriticInsensitive, .caseInsensitive, .widthInsensitive], locale: nil).lowercased()
    for suffix in ["駅", "station"] where base.hasSuffix(suffix) {
      base = String(base.dropLast(suffix.count))
    }
    return String(base.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) })
  }

  private func directionsRequest(_ request: EtaRequest, source: MKMapItem, destination: MKMapItem, transport: MKDirectionsTransportType) -> MKDirections.Request {
    let directions = MKDirections.Request()
    directions.source = source
    directions.destination = destination
    directions.transportType = transport
    if let arriveBy = request.arriveBy {
      directions.arrivalDate = Date(timeIntervalSince1970: arriveBy / 1000)
    } else if let departAt = request.departAt {
      directions.departureDate = Date(timeIntervalSince1970: departAt / 1000)
    }
    return directions
  }
}

private extension UIColor {
  convenience init(hex: String) {
    var value: UInt64 = 0
    Scanner(string: hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))).scanHexInt64(&value)
    self.init(
      red: CGFloat((value >> 16) & 0xFF) / 255,
      green: CGFloat((value >> 8) & 0xFF) / 255,
      blue: CGFloat(value & 0xFF) / 255,
      alpha: 1
    )
  }
}
