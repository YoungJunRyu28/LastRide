import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type Coordinate = { latitude: number; longitude: number };
/** A point that is a station: MapKit then routes to the station place itself (see the Swift module). */
export type RoutePoint = Coordinate & { stationNames?: string[] };

export type TransitEta = {
  departureMs: number;
  arrivalMs: number;
  travelSeconds: number;
  distanceMeters: number;
  /** The destination was found as the station place, so arrival is the train's (not a walk out to a map point). */
  arrivesAtStation?: boolean;
};
export type WalkingRoute = { distanceMeters: number; seconds: number; path: Coordinate[] };
export type Place = {
  name: string;
  latitude: number;
  longitude: number;
  phone: string | null;
  category: string | null;
  /** City / ward, e.g. "渋谷区". */
  locality: string | null;
  /** Prefecture, e.g. "東京都". */
  administrativeArea: string | null;
};
export type AddressPlace = Place & { label: string };

type NativeModule = {
  /** Sets the app's iOS language (applies from the next launch); true if a restart is needed for it. */
  setPreferredLanguage(language: 'ja' | 'en'): boolean;
  transitEta(request: { from: RoutePoint; to: RoutePoint; arriveBy?: number; departAt?: number }): Promise<TransitEta>;
  walkingRoute(from: Coordinate, to: RoutePoint): Promise<WalkingRoute>;
  searchPlaces(query: string, center: Coordinate, radiusMeters: number): Promise<Place[]>;
  /** Stations (Apple's public-transport places) within `radiusMeters`. */
  nearbyStations(center: Coordinate, radiusMeters: number): Promise<Place[]>;
  searchStations(query: string): Promise<Place[]>;
  searchAddresses(query: string): Promise<AddressPlace[]>;
  drivingEta(from: Coordinate, to: Coordinate): Promise<{ seconds: number; distanceMeters: number }>;
  snapshot(request: {
    center: Coordinate;
    spanMeters: number;
    width: number;
    height: number;
    path?: Coordinate[];
    pins?: Array<Coordinate & { emphasis?: boolean }>;
    accent?: string;
  }): Promise<string>;
};

/** Null off iOS or in builds without the module (Expo Go, web). */
export const AppleMaps = Platform.OS === 'ios' ? requireOptionalNativeModule<NativeModule>('AppleMaps') : null;
