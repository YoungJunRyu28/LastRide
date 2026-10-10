import ExpoModulesCore
import MapKit
import UIKit

struct Coordinate: Record {
  @Field var latitude: Double = 0
  @Field var longitude: Double = 0

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

    AsyncFunction("transitEta") { (request: EtaRequest, promise: Promise) in
      let directions = MKDirections(request: self.directionsRequest(request, transport: .transit))
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
        ])
      }
    }

    AsyncFunction("walkingRoute") { (from: Coordinate, to: Coordinate, promise: Promise) in
      let request = MKDirections.Request()
      request.source = MKMapItem(placemark: MKPlacemark(coordinate: from.location))
      request.destination = MKMapItem(placemark: MKPlacemark(coordinate: to.location))
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

    AsyncFunction("searchPlaces") { (query: String, center: Coordinate, radiusMeters: Double, promise: Promise) in
      let request = MKLocalSearch.Request()
      request.naturalLanguageQuery = query
      request.region = MKCoordinateRegion(center: center.location, latitudinalMeters: radiusMeters * 2, longitudinalMeters: radiusMeters * 2)
      request.resultTypes = .pointOfInterest
      MKLocalSearch(request: request).start { response, error in
        guard let items = response?.mapItems else {
          promise.reject("ERR_SEARCH", error?.localizedDescription ?? "No results")
          return
        }
        promise.resolve(items.map { item -> [String: Any] in
          let coordinate = item.placemark.coordinate
          return [
            "name": item.name ?? "",
            "latitude": coordinate.latitude,
            "longitude": coordinate.longitude,
            "phone": item.phoneNumber ?? NSNull(),
            "category": item.pointOfInterestCategory?.rawValue ?? NSNull(),
          ]
        })
      }
    }

    AsyncFunction("snapshot") { (request: SnapshotRequest, promise: Promise) in
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
        do {
          try image.pngData()?.write(to: url)
          promise.resolve(url.absoluteString)
        } catch {
          promise.reject("ERR_SNAPSHOT_WRITE", error.localizedDescription)
        }
      }
    }
  }

  private func directionsRequest(_ request: EtaRequest, transport: MKDirectionsTransportType) -> MKDirections.Request {
    let directions = MKDirections.Request()
    directions.source = MKMapItem(placemark: MKPlacemark(coordinate: request.from.location))
    directions.destination = MKMapItem(placemark: MKPlacemark(coordinate: request.to.location))
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
