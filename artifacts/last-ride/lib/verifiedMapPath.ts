/** Shared iOS/Android policy: show route geometry ONLY when it is complete,
 * finite and provided by a routing engine; do not join invalid gaps. */
import { isValidMapCoordinate } from './mapSnapshotGuard';
export type Point = { latitude: number; longitude: number };
export function verifiedMapPath(path: Point[] | undefined | null, maxVertices = 450): Point[] {
  if (!path || path.length < 2 || !path.every(isValidMapCoordinate) ||
      !Number.isSafeInteger(maxVertices) || maxVertices < 2) return [];
  const step = Math.max(1, Math.ceil((path.length - 1) / (maxVertices - 1)));
  const decimated = path.filter((_point, index) => index % step === 0);
  if (decimated[decimated.length - 1] !== path[path.length - 1]) decimated.push(path[path.length - 1]);
  return decimated;
}
