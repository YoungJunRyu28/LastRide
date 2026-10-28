import {describe,it,expect} from 'vitest';
import {
  assertRuntimeTransitFresh,
  maxTransitSnapshotAgeDays,
  DEFAULT_TRANSIT_MAX_AGE_DAYS,
  TRANSIT_FUTURE_TOLERANCE_MS,
} from './transitFreshness';

const now = Date.parse('2026-10-17T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

describe('production runtime timetable freshness', () => {
  it('accepts a recent snapshot including a timezone offset', () => {
    expect(() => assertRuntimeTransitFresh('2026-10-16T23:00:00+09:00',now)).not.toThrow();
    expect(() => assertRuntimeTransitFresh(iso(now - 30*86400000),now)).not.toThrow();
  });
  it('rejects stale data even when the server loaded it successfully earlier', () => {
    const generated = iso(now - 20*86400000);
    expect(() => assertRuntimeTransitFresh(generated,now)).not.toThrow();
    expect(() => assertRuntimeTransitFresh(generated,now + 11*86400000))
      .toThrow(/expired/);
  });
  it('refuses future timestamps beyond clock skew tolerance', () => {
    expect(() => assertRuntimeTransitFresh(iso(now + TRANSIT_FUTURE_TOLERANCE_MS),now)).not.toThrow();
    expect(() => assertRuntimeTransitFresh(iso(now + TRANSIT_FUTURE_TOLERANCE_MS + 1),now))
      .toThrow(/future/);
  });
  it('refuses missing, ambiguous, invalid and legacy timestamps', () => {
    for(const timestamp of [undefined,null,'','2026-10-17','2026-10-17T12:00:00',
      'nope','2026-02-34T12:00:00Z',{},0]){
      expect(() => assertRuntimeTransitFresh(timestamp,now)).toThrow();
    }
  });
  it('never silently disables expiry with an invalid environment variable', () => {
    expect(maxTransitSnapshotAgeDays(undefined)).toBe(DEFAULT_TRANSIT_MAX_AGE_DAYS);
    expect(maxTransitSnapshotAgeDays('7')).toBe(7);
    for(const value of ['abc','NaN','0','-1','Infinity','366']){
      expect(() => maxTransitSnapshotAgeDays(value)).toThrow(/TRANSIT_SNAPSHOT_MAX_AGE_DAYS/);
    }
  });
  it('rejects invalid computed ages', () => {
    for(const age of [0,-1,NaN,Infinity,366]){
      expect(() => assertRuntimeTransitFresh(iso(now),now,age)).toThrow();
    }
    expect(() => assertRuntimeTransitFresh(iso(now),NaN)).toThrow();
  });
});
