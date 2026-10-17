/** Pure Android Geocoder output validation; no Google Places API bills. */
import { isValidMapCoordinate } from './mapSnapshotGuard';
export type NativeGeocodeResult = { latitude: number; longitude: number };
export function normalizeAndroidGeocodes(query: string, results: NativeGeocodeResult[]): Array<{ label: string; latitude: number; longitude: number }> {
  const seen = new Set<string>();
  return results.filter(isValidMapCoordinate).filter((point) => {
    const key = `${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5).map((point, i) => ({
    label: results.length > 1 ? `${query} (${i + 1})` : query,
    latitude: point.latitude,
    longitude: point.longitude,
  }));
}
