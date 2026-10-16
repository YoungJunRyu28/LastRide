import { describe, expect, test } from "vitest";
import { isSafeMapSnapshotFrame, isValidMapCoordinate } from "@/lib/mapSnapshotGuard";

describe("MapKit snapshot NSException prevention", () => {
  const frame = { center: { latitude: 35.658, longitude: 139.701 }, spanMeters: 1200, width: 350, height: 186 };
  test("allows normal Shibuya map frames", () => {
    expect(isSafeMapSnapshotFrame(frame)).toBe(true);
  });
  test("rejects NaN, infinities and off-world or polar coordinates", () => {
    for (const invalid of [NaN, Infinity, -Infinity, 91]) {
      expect(isValidMapCoordinate({ latitude: invalid, longitude: 139 })).toBe(false);
    }
    expect(isSafeMapSnapshotFrame({ ...frame, center: { latitude: 86, longitude: 0 } })).toBe(false);
    expect(isSafeMapSnapshotFrame({ ...frame, center: { latitude: 35, longitude: 181 } })).toBe(false);
  });
  test("rejects invalid or unreasonably large dimensions and spans", () => {
    for (const input of [
      { width: 0 }, { height: 0 }, { width: Infinity }, { height: NaN },
      { width: 9000 }, { spanMeters: 0 }, { spanMeters: 3_000_000 },
      { width: 350, height: 1, spanMeters: 500_000 },
    ]) {
      expect(isSafeMapSnapshotFrame({ ...frame, ...input })).toBe(false);
    }
  });
});
