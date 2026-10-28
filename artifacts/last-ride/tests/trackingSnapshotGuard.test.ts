import { describe, expect, it } from 'vitest';
import { usableTrackingSnapshot } from '@/lib/trackingSnapshotGuard';
import type { NightPlan } from '@/lib/planner';

const now = Date.UTC(2026, 9, 26, 12, 0);
const station = { name: 'Shinjuku', nameJa: '新宿', latitude: 35.69, longitude: 139.70 };
const choice = {
  station, destination: station,
  walkingMinutes: 8, distanceMeters: 700,
  leaveByMs: now + 120_000,
  lastTrain: { departsAt: now + 1_800_000, arrivesAt: now + 3_000_000, source: 'test' },
};

function plan(overrides: Record<string, unknown> = {}): NightPlan {
  return {
    ...choice,
    computedAt: now,
    coordinates: { latitude: 35.69, longitude: 139.70 },
    alternatives: [choice],
    autoPick: choice,
    pinned: false,
    ...overrides,
  } as NightPlan;
}

describe('headless night tracking snapshot validation', () => {
  it('accepts a complete recent night plan', () => {
    expect(usableTrackingSnapshot(plan(), now)).toBe(true);
  });
  it('rejects missing and corrupt timestamps that previously bypassed the age check', () => {
    for (const computedAt of [undefined, null, 'yesterday', NaN, Infinity, -Infinity,
      now - 37 * 60 * 60_000, now + 6 * 60_000]) {
      expect(usableTrackingSnapshot(plan({ computedAt }), now)).toBe(false);
    }
  });
  it('rejects missing train data before code tries to calculate tracking end times', () => {
    for (const lastTrain of [undefined, {}, { departsAt: null }, { departsAt: Infinity }]) {
      expect(usableTrackingSnapshot(plan({ lastTrain }), now)).toBe(false);
    }
    expect(usableTrackingSnapshot(plan({ alternatives: [{ ...choice, lastTrain: {} }] }), now)).toBe(false);
    expect(usableTrackingSnapshot(plan({ autoPick: {} }), now)).toBe(false);
  });
  it('rejects invalid locations, partial plans and non-finite departure deadlines', () => {
    expect(usableTrackingSnapshot(plan({ leaveByMs: NaN }), now)).toBe(false);
    expect(usableTrackingSnapshot(plan({ coordinates: { latitude: 999, longitude: 140 } }), now)).toBe(false);
    expect(usableTrackingSnapshot(plan({ station: null }), now)).toBe(false);
    expect(usableTrackingSnapshot(plan({ alternatives: null }), now)).toBe(false);
    expect(usableTrackingSnapshot(plan({ pinned: undefined }), now)).toBe(false);
    expect(usableTrackingSnapshot(null, now)).toBe(false);
  });
});
