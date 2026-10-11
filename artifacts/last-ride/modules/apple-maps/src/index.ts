import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type Coordinate = { latitude: number; longitude: number };

export type TransitEta = { departureMs: number; arrivalMs: number; travelSeconds: number; distanceMeters: number };
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
  transitEta(request: { from: Coordinate; to: Coordinate; arriveBy?: number; departAt?: number }): Promise<TransitEta>;
  walkingRoute(from: Coordinate, to: Coordinate): Promise<WalkingRoute>;
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
