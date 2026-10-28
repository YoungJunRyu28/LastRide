/** Validates native MapKit snapshot input before Objective-C can throw. */
type Coordinate = { latitude: number; longitude: number };
type SnapshotFrame = { center: Coordinate; spanMeters: number; width: number; height: number };

export function isValidMapCoordinate(point: Coordinate): boolean {
  return (
    Number.isFinite(point.latitude) && Number.isFinite(point.longitude) &&
    Math.abs(point.latitude) <= 85 && Math.abs(point.longitude) <= 180
  );
}

export function isSafeMapSnapshotFrame(frame: SnapshotFrame): boolean {
  const { center, spanMeters, width, height } = frame;
  return (
    isValidMapCoordinate(center) &&
    [spanMeters, width, height].every(Number.isFinite) &&
    spanMeters > 1 && spanMeters < 2_000_000 &&
    width >= 1 && width <= 4096 && height >= 1 && height <= 4096 &&
    spanMeters * width / height < 2_000_000
  );
}
