/**
 * Stations kept on the phone (saved destinations, the home station) are stored
 * with our server's ODPT data where it has the station, not Apple's: Apple's
 * terms only allow keeping Map Data temporarily (Program License Agreement,
 * Attachment 6, 2.5). Stations ODPT doesn't cover (JR, private railways) keep
 * what the user picked.
 */
import { searchStations as searchStationsApi } from '@workspace/api-client-react';
import { apiBaseUrl } from '@/lib/api';
import { stationBaseName } from '@/lib/applePlaces';
import { distanceBetween, type StationOption } from '@/lib/stations';

/** The same station: same name and close by (station points differ by up to a few hundred metres). */
const SAME_STATION_METERS = 800;

export type StationLookup = (query: string) => Promise<StationOption[]>;

const serverLookup: StationLookup = async (query) => {
  const stations = await searchStationsApi({ q: query });
  return stations.map(({ id: _id, walkingMeters: _meters, walkingMinutes: _minutes, region, ...station }) => ({
    ...station,
    regionJa: region,
  }));
};

/** The server's record of `station`, or `station` itself when there's no match (or no server). */
export async function stationForStorage(
  station: StationOption,
  lookup: StationLookup | null = apiBaseUrl ? serverLookup : null,
): Promise<StationOption> {
  if (!lookup) return station;
  const base = stationBaseName(station.nameJa);
  const results = await lookup(base).catch(() => [] as StationOption[]);
  const match = results.find(
    (candidate) =>
      stationBaseName(candidate.nameJa) === base &&
      distanceBetween(candidate, station) <= SAME_STATION_METERS,
  );
  return match
    ? { ...match, region: match.region ?? station.region, regionJa: match.regionJa ?? station.regionJa, source: 'odpt' }
    : station;
}
