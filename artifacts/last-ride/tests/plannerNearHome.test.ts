/**
 * planNight at (or by) the home station: no train to take, even when the next
 * station over has one that goes home.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ nearby: vi.fn(), walk: vi.fn(), lastTrain: vi.fn() }));

vi.mock('@workspace/api-client-react', () => ({ getTrainDisruptions: vi.fn(async () => []) }));
vi.mock('@/lib/storedPlaces', () => ({
  hasPosition: (place: { latitude?: number } | null) => !!place && Number.isFinite(place.latitude),
  resolveStation: vi.fn(async (station: unknown) => station),
  resolveAddress: vi.fn(async (address: unknown) => address),
}));
vi.mock('@/lib/stations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stations')>('@/lib/stations');
  return { ...actual, findNearbyStations: mocks.nearby, walkingRoute: mocks.walk };
});
vi.mock('@/lib/timetable', async () => {
  class AppleLookupFailed extends Error {}
  return { AppleLookupFailed, getLastTrain: mocks.lastTrain, trainsBefore: vi.fn(async () => []) };
});

import { planNight, planOrigin } from '@/lib/planner';

const jst = (hours: number, minutes = 0) => Date.UTC(2026, 9, 9, hours - 9, minutes);

const home = { name: 'Nakano', nameJa: '中野', latitude: 35.7056, longitude: 139.6659 };
const nextOver = { name: 'Higashi-Nakano', nameJa: '東中野', latitude: 35.7066, longitude: 139.6828 };
const walk = { walkingMinutes: 4, distanceMeters: 300, source: 'routed' as const };

beforeEach(() => {
  mocks.walk.mockReset().mockResolvedValue(walk);
  // 中野 → 中野 has no train; 東中野 has one, one stop home.
  mocks.lastTrain.mockReset().mockImplementation(async (from: { nameJa: string }) =>
    from.nameJa === '中野' ? null : { departsAt: jst(24, 20), arrivesAt: jst(24, 23), source: 'live' });
});

describe('near home', () => {
  test('at the home station: near-home, not a trip from the next station over', async () => {
    mocks.nearby.mockResolvedValue([{ station: home, straightMeters: 150, walk }, { station: nextOver, straightMeters: 1400, walk: { ...walk, walkingMinutes: 18 } }]);
    await expect(planNight({ latitude: 35.7060, longitude: 139.6670 }, home, 4, jst(22), { nightOf: jst(22) })).rejects.toMatchObject({ code: 'near-home' });
  });

  test('a chosen station is planned anyway', async () => {
    mocks.nearby.mockResolvedValue([{ station: home, straightMeters: 150, walk }, { station: nextOver, straightMeters: 1400, walk: { ...walk, walkingMinutes: 18 } }]);
    const plan = await planNight({ latitude: 35.7060, longitude: 139.6670 }, home, 4, jst(22), { nightOf: jst(22), pinned: nextOver });
    expect(plan.station.nameJa).toBe('東中野');
  });

  test('closest station is another one: planned as usual', async () => {
    mocks.nearby.mockResolvedValue([{ station: nextOver, straightMeters: 200, walk }, { station: home, straightMeters: 1500, walk: { ...walk, walkingMinutes: 19 } }]);
    const plan = await planNight({ latitude: 35.7068, longitude: 139.6815 }, home, 4, jst(22), { nightOf: jst(22) });
    expect(plan.station.nameJa).toBe('東中野');
  });
});

describe('planOrigin', () => {
  const here = { latitude: 35.7, longitude: 139.66 };
  test('a chosen station within walking reach: from here', () => {
    expect(planOrigin(here, nextOver)).toBe(here);
  });
  test('a chosen station far away: from the station', () => {
    const far = { ...nextOver, latitude: 35.9 };
    expect(planOrigin(here, far)).toEqual({ latitude: 35.9, longitude: nextOver.longitude });
  });
  test('nothing chosen: from here', () => {
    expect(planOrigin(here, null)).toBe(here);
  });
});
