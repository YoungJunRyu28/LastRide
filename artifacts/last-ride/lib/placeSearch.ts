/**
 * Station and address search, shared by the app and the background location
 * task (which re-resolves saved places; see lib/storedPlaces).
 */
import { searchAddresses as searchAddressesApi, searchStations as searchStationsApi } from "@workspace/api-client-react";
import { apiBaseUrl, communityFallbacksEnabled } from "@/lib/api";
import { appleSearchAddresses, appleSearchStations } from "@/lib/applePlaces";
import { nativeAddressSearch } from "@/lib/nativeAddressSearch";
import type { HomeAddress } from "@/lib/settings";
import type { StationOption } from "@/lib/stations";

type PhotonFeature = {
  properties?: {
    osm_id?: number;
    name?: string;
    state?: string;
    city?: string;
    district?: string;
  };
  geometry?: { coordinates?: [number, number] };
};

/**
 * Searches Japanese railway stations by name: Apple Maps on iOS, then the API
 * server (ODPT stations — subways only), then in development the Photon
 * geocoder (OSM data), which also understands English names.
 */
export async function searchStations(query: string): Promise<StationOption[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const apple = await appleSearchStations(trimmed).catch(() => null);
  if (apple && apple.length > 0) return apple;
  if (apiBaseUrl) {
    try {
      const stations = await searchStationsApi({ q: trimmed });
      if (stations.length > 0) {
        return stations.map(
          ({
            id: _id,
            walkingMeters: _meters,
            walkingMinutes: _minutes,
            walkingSource: _walkSource,
            region,
            ...station
          }) => ({ ...station, regionJa: region }),
        );
      }
      if (!communityFallbacksEnabled) return [];
    } catch {
      if (!communityFallbacksEnabled) {
        throw new Error("Station search is temporarily unavailable.");
      }
    }
  }
  // Only reached without a configured server in production builds.
  if (!communityFallbacksEnabled) {
    throw new Error("Station search is temporarily unavailable.");
  }
  return searchStationsPhoton(trimmed);
}

async function searchStationsPhoton(trimmed: string): Promise<StationOption[]> {
  // Japan bounding box keeps results domestic; two requests give local + English names.
  const base = `https://photon.komoot.io/api/?q=${encodeURIComponent(trimmed)}&osm_tag=railway:station&limit=12&bbox=122,24,154,46`;
  const [defaultResponse, englishResponse] = await Promise.all([
    fetch(`${base}&lang=default`),
    fetch(`${base}&lang=en`),
  ]);
  if (!defaultResponse.ok)
    throw new Error("Station search is temporarily unavailable.");
  const defaultPayload = (await defaultResponse.json()) as {
    features?: PhotonFeature[];
  };
  const englishFeatures = new Map<number, PhotonFeature["properties"]>();
  if (englishResponse.ok) {
    const englishPayload = (await englishResponse.json()) as {
      features?: PhotonFeature[];
    };
    for (const feature of englishPayload.features ?? []) {
      if (feature.properties?.osm_id !== undefined && feature.properties.name) {
        englishFeatures.set(feature.properties.osm_id, feature.properties);
      }
    }
  }
  const seen = new Set<string>();
  const options: StationOption[] = [];
  for (const feature of defaultPayload.features ?? []) {
    const coordinates = feature.geometry?.coordinates;
    const props = feature.properties;
    const localName = props?.name;
    if (!coordinates || !localName) continue;
    const [longitude, latitude] = coordinates;
    const english =
      (props?.osm_id !== undefined && englishFeatures.get(props.osm_id)) ||
      undefined;
    const englishName = english?.name || localName;
    const regionJa =
      [props?.state, props?.city, props?.district].filter(Boolean).join("") ||
      undefined;
    const region =
      [english?.city || props?.city, english?.state || props?.state]
        .filter(Boolean)
        .join(", ") || undefined;
    // Collapse duplicate entries for the same station complex (multiple operators / entrances):
    // same name within the same city+district is one station to the user.
    const key = props?.city
      ? `${localName}|${props.city}|${props.district ?? ""}`
      : `${localName}|${latitude.toFixed(2)}|${longitude.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({
      name: englishName,
      nameJa: localName,
      latitude,
      longitude,
      region,
      regionJa,
    });
  }
  return options.slice(0, 8);
}

/** Searches Japanese addresses: MapKit on iOS, native Geocoder on Android.
 * The server is the final fallback; it intentionally does not forward user
 * addresses to unauthenticated public geocoding services in production. */
export async function searchAddresses(query: string): Promise<HomeAddress[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const apple = await appleSearchAddresses(trimmed).catch(() => null);
  if (apple) return apple;
  let nativeError: unknown;
  try {
    const android = await nativeAddressSearch(trimmed);
    if (android && android.length > 0) return android;
  } catch (error) {
    nativeError = error;
  }
  if (apiBaseUrl) {
    try {
      const results = await searchAddressesApi({ q: trimmed });
      if (results.length > 0) return results.map((address) => ({
        label: address.name,
        latitude: address.latitude,
        longitude: address.longitude,
      }));
    } catch {
      // The backend geocoder may be disabled; preserve a specific native error.
    }
  }
  if (nativeError) throw nativeError;
  return [];
}

