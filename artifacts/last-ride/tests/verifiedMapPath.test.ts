import { describe, expect, it } from 'vitest';
import { verifiedMapPath } from '@/lib/verifiedMapPath';

describe('iOS/Android verified route drawing', () => {
  const a = { latitude: 35.659, longitude: 139.701 };
  const b = { latitude: 35.66, longitude: 139.703 };
  it('draws no route in the absence of verified geometry', () => {
    expect(verifiedMapPath(undefined)).toEqual([]);
    expect(verifiedMapPath([a])).toEqual([]);
    expect(verifiedMapPath([])).toEqual([]);
  });
  it('does not bridge malformed segments with a fake shortcut', () => {
    expect(verifiedMapPath([a, { latitude: NaN, longitude: 139.702 }, b])).toEqual([]);
    expect(verifiedMapPath([a, { latitude: 95, longitude: 139.702 }, b])).toEqual([]);
  });
  it('preserves correct ordered endpoints and limits memory/GPU cost', () => {
    const path = Array.from({length: 50000}, (_, i) => ({ latitude: 35.3 + i / 100000, longitude: 139.4 }));
    const result = verifiedMapPath(path);
    expect(result[0]).toBe(path[0]);
    expect(result[result.length - 1]).toBe(path[path.length - 1]);
    expect(result.length).toBeLessThanOrEqual(450);
  });
  it('keeps valid short walking polylines intact', () => {
    expect(verifiedMapPath([a, b])).toEqual([a, b]);
  });
});
