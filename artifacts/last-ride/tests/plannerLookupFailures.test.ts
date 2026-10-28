/**
 * planNight when train lookups fail: one destination failing mustn't throw away
 * another's answer, and a station whose every lookup failed keeps its result
 * from the plan before (instead of dropping out and letting a far station win).
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  nearby: vi.fn(),
  walk: vi.fn(),
  lastTrain: vi.fn(),
}));

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

import { planNight, type NightPlan } from '@/lib/planner';
import { AppleLookupFailed } from '@/lib/timetable';
import { MINUTE_MS } from '@/lib/time';

/** A Japan wall-clock time on the night of 9 Oct 2026 (24:10 = 00:10 after midnight). */
const jst = (hours: number, minutes = 0) => Date.UTC(2026, 9, 9, hours - 9, minutes);

const here = { latitude: 35.4425, longitude: 139.6505 };
const motomachi = { name: 'Motomachi-Chukagai', nameJa: '元町・中華街', latitude: 35.4428, longitude: 139.6498 };
const home = { name: 'Kikuna', nameJa: '菊名', latitude: 35.5097, longitude: 139.6305 };
const otherHomeStation = { name: 'Okurayama', nameJa: '大倉山', latitude: 35.5225, longitude: 139.6297 };
const address = { label: '横浜市港北区', latitude: 35.515, longitude: 139.63 };
const walk = { walkingMinutes: 4, distanceMeters: 300, source: 'routed' as const };

beforeEach(() => {
  mocks.nearby.mockReset().mockImplementation(async (from: { latitude: number }) =>
    // Near the home address: both home stations; near here: 元町・中華街.
    from.latitude > 35.5 ? [{ station: home, straightMeters: 600, walk }, { station: otherHomeStation, straightMeters: 900, walk }] : [{ station: motomachi, straightMeters: 80, walk }]);
  mocks.walk.mockReset().mockResolvedValue(walk);
  mocks.lastTrain.mockReset();
});

describe('train lookups failing', () => {
  test('one destination failing doesn’t discard another’s answer', async () => {
    mocks.lastTrain.mockImplementation(async (_from: unknown, to: { nameJa: string }) => {
      if (to.nameJa === '菊名') throw new AppleLookupFailed('throttled');
      return { departsAt: jst(23, 40), arrivesAt: jst(24, 10), source: 'live' };
    });
    const plan = await planNight(here, home, 4, jst(21), { homeAddress: address, nightOf: jst(21) });
    expect(plan.station.nameJa).toBe('元町・中華街');
    expect(plan.destination.nameJa).toBe('大倉山');
  });

  test('every lookup failing keeps the station’s result from the plan before, with this spot’s walk', async () => {
    mocks.lastTrain.mockResolvedValue({ departsAt: jst(23, 40), arrivesAt: jst(24, 10), source: 'live' });
    const before: NightPlan = await planNight(here, home, 4, jst(21), { nightOf: jst(21) });
    expect(before.station.nameJa).toBe('元町・中華街');

    // Ten minutes later Apple refuses every train lookup; the walk from here is now 6 minutes and only estimated.
    mocks.lastTrain.mockRejectedValue(new AppleLookupFailed('throttled'));
    mocks.nearby.mockResolvedValue([{ station: motomachi, straightMeters: 200, walk: { walkingMinutes: 6, distanceMeters: 450, source: 'estimated' } }]);
    const after = await planNight({ latitude: 35.444, longitude: 139.651 }, home, 4, jst(21, 10), { nightOf: jst(21), previous: before });
    expect(after.station.nameJa).toBe('元町・中華街');
    expect(after.lastTrain.departsAt).toBe(jst(23, 40));
    expect(after.walkingMinutes).toBe(6);
    // Still marked as an estimate (「（推定）」 and the extra margin), not carried as a stray field.
    expect(after.walkingSource).toBe('estimated');
    expect(after.leaveByMs).toBe(jst(23, 40) - (6 + 3) * MINUTE_MS);
  });

  test('from (about) the same spot, an Apple route is reused but an estimate is looked up again', async () => {
    mocks.lastTrain.mockResolvedValue({ departsAt: jst(23, 40), arrivesAt: jst(24, 10), source: 'live' });
    const routed = { walkingMinutes: 4, distanceMeters: 300, source: 'routed' as const, path: [here, motomachi] };
    mocks.nearby.mockImplementation(async (_from: unknown, _speed: unknown, _limit: unknown, known?: Map<string, unknown>) =>
      [{ station: motomachi, straightMeters: 80, walk: known?.get('元町・中華街') }]);
    mocks.walk.mockResolvedValue(routed);
    const first = await planNight(here, home, 4, jst(21), { nightOf: jst(21) });
    expect(mocks.walk).toHaveBeenCalledTimes(1);
    expect(first.walkPath).toEqual([here, motomachi]);
    // Two minutes later from the same spot: the route (with its shape) is reused, not asked for again.
    await planNight(here, home, 4, jst(21, 2), { nightOf: jst(21), previous: first });
    expect(mocks.walk).toHaveBeenCalledTimes(1);
    // A plan whose walk was only an estimate (or an older plan without a source): asked again.
    const estimated = { ...first, walkingSource: 'estimated' as const, walkPath: undefined, alternatives: [] };
    await planNight(here, home, 4, jst(21, 4), { nightOf: jst(21), previous: estimated });
    expect(mocks.walk).toHaveBeenCalledTimes(2);
  });
});

