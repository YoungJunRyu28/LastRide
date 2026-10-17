import { describe, expect, test } from 'vitest';
import { googleMapOverlays, googleZoomForFrame } from '@/lib/googleMapGeometry';
import { normalizeAndroidGeocodes } from '@/lib/androidGeocode';

describe('Android native map geometry and safety', () => {
  const frame = { center: { latitude: 35.659, longitude: 139.702 }, spanMeters: 1500, width: 350, height: 190 };
  test('Shibuya frame maps to sensible native zoom', () => {
    const zoom = googleZoomForFrame(frame);
    expect(zoom).toBeGreaterThan(12);
    expect(zoom).toBeLessThan(19);
  });
  test('native zoom never receives invalid/NaN from corrupt stored data', () => {
    for (const bad of [NaN, Infinity, -Infinity, 0, -50]) {
      expect(googleZoomForFrame({ ...frame, spanMeters: bad })).toBe(3);
    }
    expect(googleZoomForFrame({ ...frame, center: { latitude: NaN, longitude: 0 } })).toBe(3);
  });
  test('filters invalid coordinates before passing pins and lines into Google SDK', () => {
    const out = googleMapOverlays({
      you: { latitude: 35.659, longitude: 139.702 },
      target: { latitude: 35.66, longitude: 139.703 },
      path: [
        { latitude: 35.659, longitude: 139.702 },
        { latitude: Infinity, longitude: 0 },
        { latitude: 35.66, longitude: 139.703 },
      ],
      pins: [
        { label: 'Valid', latitude: 35.6, longitude: 139.7 },
        { label: 'Bad', latitude: NaN, longitude: 139.7 },
        { label: 'Missing' },
      ],
    });
    expect(out.markers.map((item) => item.id)).toEqual(['you', 'target', 'pin-0']);
    expect(out.walkLine).toHaveLength(2);
  });
  test('native polyline and pin count bounded on 50k path input', () => {
    const path = Array.from({ length: 50_000 }, (_, i) => ({ latitude: 35.1 + i / 100_000, longitude: 139 }));
    const out = googleMapOverlays({
      you: path[0], target: path[path.length - 1], path,
      pins: Array.from({ length: 200 }, (_, i) => ({ label: `Pin ${i}`, latitude: 35.2, longitude: 139.2 })),
    });
    expect(out.markers).toHaveLength(18);
    expect(out.walkLine.length).toBeLessThanOrEqual(451);
    expect(out.walkLine[0]).toEqual(path[0]);
    expect(out.walkLine[out.walkLine.length - 1]).toEqual(path[path.length - 1]);
  });
  test('missing walking path never draws a fictitious straight-line walking route', () => {
    const a = { latitude: 35.658, longitude: 139.7 };
    const b = { latitude: 35.66, longitude: 139.701 };
    const result = googleMapOverlays({ you: a, target: b });
    expect(result.walkLine).toEqual([]);
    expect(result.markers).toHaveLength(2);
  });
});

describe('Android native geocoder output', () => {
  test('deduplicates, clamps number of suggestions, and rejects invalid coordinates', () => {
    const raw = [
      { latitude: 35.658, longitude: 139.701 },
      { latitude: 35.65800001, longitude: 139.701 },
      { latitude: NaN, longitude: 139.701 },
      ...Array.from({ length: 30 }, (_, i) => ({ latitude: 35.66 + i * .001, longitude: 139.7 })),
    ];
    const found = normalizeAndroidGeocodes('渋谷区', raw);
    expect(found).toHaveLength(5);
    expect(found[0].label).toContain('渋谷区');
    expect(found.every((x) => Number.isFinite(x.latitude))).toBe(true);
  });
  test('no service results means no fabricated address', () => {
    expect(normalizeAndroidGeocodes('Tokyo', [])).toEqual([]);
  });
});
