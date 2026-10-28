import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NightPlan } from '@/lib/planner';

// Each test controls when native AsyncStorage operations settle; the real
// underlying API does not guarantee that racing callers settle in order.
const memory = vi.hoisted(() => ({
  items: new Map<string, string>(),
  set: vi.fn(async (key: string, value: string) => { memory.items.set(key, value); }),
  get: vi.fn(async (key: string) => memory.items.get(key) ?? null),
  remove: vi.fn(async (key: string) => { memory.items.delete(key); }),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (...args: Parameters<typeof memory.get>) => memory.get(...args),
    setItem: (...args: Parameters<typeof memory.set>) => memory.set(...args),
    removeItem: (...args: Parameters<typeof memory.remove>) => memory.remove(...args),
  },
}));
import { clearSavedPlan, readSavedPlan, writeSavedPlan } from '@/lib/savedPlan';

const at = Date.parse('2026-10-22T21:00:00+09:00');
function aPlan(computedAt: number, leaveByMs = at + 60 * 60_000): NightPlan {
  const station = { name: 'Shibuya', nameJa: '渋谷', latitude: 35.66, longitude: 139.7 };
  const choice = {
    station, destination: station, distanceMeters: 500, walkingMinutes: 8,
    walkingSource: 'routed' as const,
    lastTrain: { departsAt: at + 90 * 60_000, source: 'live' as const },
    leaveByMs, recommendedLeaveByMs: leaveByMs, safetyMarginMinutes: 0,
  };
  return { ...choice, computedAt, coordinates: station, pinned: false, alternatives: [], autoPick: choice };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const KEY = 'lastride-last-plan';

beforeEach(async () => {
  await clearSavedPlan();
  memory.items.clear();
  memory.set.mockReset().mockImplementation(async (key, value) => { memory.items.set(key, value); });
  memory.get.mockReset().mockImplementation(async (key) => memory.items.get(key) ?? null);
  memory.remove.mockReset().mockImplementation(async (key) => { memory.items.delete(key); });
});

describe('saved overnight plan write ordering', () => {
  it('never lets an old, slow native write replace a newer route', async () => {
    const gate = deferred<void>();
    const events: string[] = [];
    memory.set.mockImplementationOnce(async (key, value) => {
      events.push('old-start');
      await gate.promise;
      memory.items.set(key, value);
      events.push('old-end');
    });
    const old = writeSavedPlan(aPlan(at - 2_000, at + 40 * 60_000));
    await Promise.resolve(); await Promise.resolve(); // initial queued operation begins
    const fresh = writeSavedPlan(aPlan(at, at + 55 * 60_000));
    await Promise.resolve();
    expect(events).toEqual(['old-start']);
    expect(memory.set).toHaveBeenCalledTimes(1);
    gate.resolve();
    await Promise.all([old, fresh]);
    expect(JSON.parse(memory.items.get(KEY)!).leaveByMs).toBe(at + 55 * 60_000);
  });

  it('does not let a slow saved-plan write recreate a trip after reset', async () => {
    const gate = deferred<void>();
    memory.set.mockImplementationOnce(async (key, value) => {
      await gate.promise;
      memory.items.set(key, value);
    });
    const writing = writeSavedPlan(aPlan(at));
    await Promise.resolve(); await Promise.resolve();
    const clearing = clearSavedPlan();
    gate.resolve();
    await Promise.all([writing, clearing]);
    expect(memory.items.has(KEY)).toBe(false);
  });

  it('does not allow cleanup from a stale read to erase a newer plan', async () => {
    const gate = deferred<string | null>();
    memory.get.mockImplementationOnce(async () => gate.promise);
    const pendingRead = readSavedPlan();
    await Promise.resolve(); await Promise.resolve();
    const write = writeSavedPlan(aPlan(at));
    // Even a corrupt record read before the new write cannot delete afterward.
    gate.resolve('{ invalid json');
    expect(await pendingRead).toBeNull();
    await write;
    expect(JSON.parse(memory.items.get(KEY)!).computedAt).toBe(at);
  });

  it('ignores an older route computation submitted after a newer route', async () => {
    await writeSavedPlan(aPlan(at, at + 40 * 60_000));
    await writeSavedPlan(aPlan(at - 60_000, at + 25 * 60_000));
    expect(JSON.parse(memory.items.get(KEY)!).leaveByMs).toBe(at + 40 * 60_000);
    expect(memory.set).toHaveBeenCalledTimes(1);
  });

  it('allows a fresh session to save again after explicit clear', async () => {
    await writeSavedPlan(aPlan(at));
    await clearSavedPlan();
    await writeSavedPlan(aPlan(at - 60_000));
    expect(JSON.parse(memory.items.get(KEY)!).computedAt).toBe(at - 60_000);
  });
});
