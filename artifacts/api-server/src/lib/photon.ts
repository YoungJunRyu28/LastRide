/**
 * Photon geocoder (OpenStreetMap data) for romaji/English station searches.
 * NAVITIME's station search only understands Japanese and kana, so "Shibuya"
 * would otherwise find nothing. Photon is free, but its usage policy asks for
 * an identifying User-Agent and modest traffic, so answers are cached.
 */
import { ProviderError, TtlCache } from "./cache";
import { providerTimeoutMs } from "./runtimeConfig";
import type { Station } from "./navitime";

const BASE_URL = "https://photon.komoot.io/api/";
const USER_AGENT = "LastRide/1.0 (last-train planner for Japan; api-server)";
const DAY_MS = 24 * 60 * 60 * 1000;

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

/** True when the query has hiragana, katakana or kanji, i.e. NAVITIME can search it. */
export function isJapaneseQuery(query: string): boolean {
  return /[぀-ヿ一-鿿]/.test(query);
}

async function photonFeatures(
  query: string,
  lang: "en" | "default",
): Promise<PhotonFeature[]> {
  // Japan bounding box keeps results domestic.
  const url = new URL(BASE_URL);
  url.search = new URLSearchParams({
    q: query,
    osm_tag: "railway:station",
    limit: "12",
    bbox: "122,24,154,46",
    lang,
  }).toString();
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(providerTimeoutMs()),
    });
  } catch (err) {
    throw new ProviderError(`Photon request failed: ${(err as Error).message}`);
  }
  if (!response.ok) throw new ProviderError(`Photon responded ${response.status}`);
  const body = (await response.json().catch(() => null)) as {
    features?: PhotonFeature[];
  } | null;
  return body?.features ?? [];
}

// Station-name queries return public station data, not anything about the
// person searching, so they may outlive the 24-hour personal-data cap.
const searchCache = new TtlCache<Station[]>(7 * DAY_MS, "photon-station-search", {
  containsPersonalData: false,
});

/** Stations whose English/romaji name matches `query`, in the endpoint's Station shape. */
export async function searchStationsPhoton(query: string): Promise<Station[]> {
  const cacheKey = query.trim();
  const cached = await searchCache.get(cacheKey);
  if (cached) return cached;

  // lang=default gives the local (Japanese) name; lang=en the English one,
  // which is optional — the local name stands in when it is unavailable.
  const [localFeatures, englishFeatures] = await Promise.all([
    photonFeatures(cacheKey, "default"),
    photonFeatures(cacheKey, "en").catch(() => [] as PhotonFeature[]),
  ]);
  const englishById = new Map<number, string>();
  for (const feature of englishFeatures) {
    if (feature.properties?.osm_id !== undefined && feature.properties.name) {
      englishById.set(feature.properties.osm_id, feature.properties.name);
    }
  }

  const seen = new Set<string>();
  const stations: Station[] = [];
  for (const feature of localFeatures) {
    const coordinates = feature.geometry?.coordinates;
    const props = feature.properties;
    if (!coordinates || !props?.name || props.osm_id === undefined) continue;
    const [longitude, latitude] = coordinates;
    // Collapse duplicate entries for the same station complex (multiple
    // operators / entrances): same name in the same city+district.
    const key = props.city
      ? `${props.name}|${props.city}|${props.district ?? ""}`
      : `${props.name}|${latitude.toFixed(2)}|${longitude.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    stations.push({
      id: String(props.osm_id),
      name: englishById.get(props.osm_id) ?? props.name,
      nameJa: props.name,
      latitude,
      longitude,
      // Japanese, like NAVITIME's address_name.
      region:
        [props.state, props.city, props.district].filter(Boolean).join("") ||
        undefined,
    });
  }
  const result = stations.slice(0, 8);
  await searchCache.set(cacheKey, result);
  return result;
}
