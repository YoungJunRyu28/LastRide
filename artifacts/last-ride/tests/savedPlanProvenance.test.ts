import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => state.store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { state.store.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { state.store.delete(key); }),
  },
}));
import { readSavedPlan, writeSavedPlan } from '@/lib/savedPlan';
import type { NightPlan } from '@/lib/planner';
import { MINUTE_MS } from '@/lib/time';

const now = Date.parse('2026-10-22T18:00:00+09:00');
function plan(overrides: Partial<NightPlan> = {}): NightPlan {
  const station = {name:'Shibuya',nameJa:'渋谷',latitude:35.66,longitude:139.7};
  const base = {
    station, destination: station, distanceMeters: 640, walkingMinutes: 8,
    lastTrain: {departsAt:now + 5*60*MINUTE_MS,source:'sample' as const},
    leaveByMs: now + 4*60*MINUTE_MS,
    recommendedLeaveByMs: now + 4*60*MINUTE_MS - 4*MINUTE_MS,
    safetyMarginMinutes: 4,
  };
  return {
    ...base, coordinates: station, computedAt:now, pinned:false,
    alternatives:[], autoPick:base, ...overrides,
  };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  state.store.clear();
});
afterEach(() => vi.useRealTimers());

describe('legacy cached plan walking confidence', () => {
  it('marks a pre-provenance plan as estimated and advances its reminder while keeping last train', async () => {
    const old = plan();
    await writeSavedPlan(old);
    const upgraded = await readSavedPlan();
    expect(upgraded).not.toBeNull();
    expect(upgraded!.walkingSource).toBe('estimated');
    expect(upgraded!.recommendedLeaveByMs).toBe(old.recommendedLeaveByMs! - 3*MINUTE_MS);
    expect(upgraded!.lastTrain).toEqual(old.lastTrain);
    expect(upgraded!.autoPick.walkingSource).toBe('estimated');
    expect(upgraded!.autoPick.recommendedLeaveByMs).toBe(old.recommendedLeaveByMs! - 3*MINUTE_MS);
  });

  it('keeps MapKit-route and already buffered estimated plans unchanged on repeated reads', async () => {
    for (const source of ['routed','estimated'] as const) {
      const current = plan({ walkingSource:source });
      await writeSavedPlan(current);
      const once = await readSavedPlan();
      const twice = await readSavedPlan();
      expect(once?.recommendedLeaveByMs).toBe(current.recommendedLeaveByMs);
      expect(twice?.recommendedLeaveByMs).toBe(once?.recommendedLeaveByMs);
      expect(once?.walkingSource).toBe(source);
    }
  });
});
