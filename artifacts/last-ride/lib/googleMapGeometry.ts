/** Coordinate validation shared by Android Maps and map rendering. */
import { isValidMapCoordinate } from "./mapSnapshotGuard";
import { verifiedMapPath } from './verifiedMapPath';

export type Point = { latitude: number; longitude: number };
export type MapFrame = { center: Point; spanMeters: number; width: number; height: number };
export type Pin = { label: string; emphasis?: boolean } & Partial<Point>;

/** Equivalent Web Mercator zoom for a native Google map at the given frame. */
export function googleZoomForFrame(frame: MapFrame): number {
  if (!isValidMapCoordinate(frame.center) ||
      !Number.isFinite(frame.spanMeters) || frame.spanMeters <= 1 ||
      !Number.isFinite(frame.height) || frame.height < 1) return 3;
  const metersPerPixel = frame.spanMeters / frame.height;
  const tileMetersPerPixel = 156543.03392 * Math.cos((frame.center.latitude * Math.PI) / 180);
  return Math.max(2, Math.min(20, Math.log2(tileMetersPerPixel / metersPerPixel)));
}

/** Never pass NaN, unbounded route polylines, or malformed coordinates to native maps. */
export function googleMapOverlays(args: {
  you?: Point | null;
  target?: Point | null;
  pins?: Pin[];
  path?: Point[];
}) {
  const { you, target, pins, path } = args;
  const clean = (p: Point | null | undefined): p is Point => !!p && isValidMapCoordinate(p);
  const markers: Array<{ id: string; coordinates: Point; title: string }> = [];
  if (clean(you)) markers.push({ id: 'you', coordinates: you, title: '現在地 / You' });
  if (clean(target)) markers.push({ id: 'target', coordinates: target, title: '目的地 / Destination' });
  for (const [i, p] of (pins ?? []).entries()) {
    if (markers.length >= 18) break;
    if (p.latitude === undefined || p.longitude === undefined || !clean(p as Point)) continue;
    markers.push({ id: `pin-${i}`, coordinates: { latitude: p.latitude, longitude: p.longitude }, title: p.label.slice(0, 90) });
  }
  // A missing or corrupt vertex invalidates the whole route; joining valid
  // vertices across a gap could send somebody across a river or highway.
  const simplified = verifiedMapPath(path);
  // Never misrepresent a straight line (through buildings, rivers, rail
  // barriers) as a walking route. Until a verified path geometry is supplied,
  // markers alone are rendered; tapping opens actual directions in Google Maps.
  const walkLine = clean(you) && clean(target) && simplified.length >= 2
    ? simplified
    : [];
  return { markers, walkLine };
}
