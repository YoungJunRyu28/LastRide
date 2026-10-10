import { describe, expect, it } from "vitest";
import {
  isLateNightHour,
  meterFareYen,
  taxiEstimate,
  walkEstimate,
  walkingMinutes,
} from "../src/lib/estimates";
import { distanceMeters } from "../src/lib/transit/transfers";
import { STATION } from "./helpers/transitFixture";

const shibuya = { latitude: STATION.shibuya.lat, longitude: STATION.shibuya.lon };
const oshiage = { latitude: STATION.oshiage.lat, longitude: STATION.oshiage.lon };
const straight = distanceMeters(STATION.shibuya, STATION.oshiage);

describe("walk estimate", () => {
  it("is the straight line × 1.3 at the pace's speed", () => {
    const walk = walkEstimate(shibuya, oshiage, "normal");
    expect(walk.distanceMeters).toBe(Math.round(straight * 1.3));
    // 4.8 km/h = 80 m a minute.
    expect(walk.minutes).toBe(Math.ceil(walk.distanceMeters / 80));
  });

  it("is slower when relaxed and faster when fast", () => {
    const relaxed = walkEstimate(shibuya, oshiage, "relaxed").minutes;
    const normal = walkEstimate(shibuya, oshiage, "normal").minutes;
    const fast = walkEstimate(shibuya, oshiage, "fast").minutes;
    expect(relaxed).toBeGreaterThan(normal);
    expect(fast).toBeLessThan(normal);
  });

  it("takes at least a minute", () => {
    expect(walkEstimate(shibuya, shibuya, "fast")).toEqual({ distanceMeters: 0, minutes: 1 });
    expect(walkingMinutes(80, "normal")).toBe(1);
    expect(walkingMinutes(81, "normal")).toBe(2);
  });
});

describe("taxi meter", () => {
  it("charges ¥500 up to 1.096 km, then ¥100 per started 255 m", () => {
    expect(meterFareYen(0)).toBe(500);
    expect(meterFareYen(1_096)).toBe(500);
    expect(meterFareYen(1_097)).toBe(600);
    expect(meterFareYen(1_096 + 255)).toBe(600);
    expect(meterFareYen(1_096 + 256)).toBe(700);
    expect(meterFareYen(1_096 + 255 * 10)).toBe(1_500);
  });

  it("treats 22:00–04:59 as late night", () => {
    expect(isLateNightHour(21)).toBe(false);
    expect(isLateNightHour(22)).toBe(true);
    expect(isLateNightHour(0)).toBe(true);
    expect(isLateNightHour(4)).toBe(true);
    expect(isLateNightHour(5)).toBe(false);
  });
});

describe("taxi estimate", () => {
  it("uses the straight line × 1.35 on the meter, at ~25 km/h plus pickup", () => {
    const day = taxiEstimate(shibuya, oshiage, "2026-10-09T14:00:00");
    const road = Math.round(straight * 1.35);
    expect(day.distanceMeters).toBe(road);
    expect(day.fareYen).toBe(meterFareYen(road));
    expect(day.minutes).toBe(Math.ceil((road / 1000 / 25) * 60) + 2);
  });

  it("adds 20% late at night, by the request's Japan start time", () => {
    const day = taxiEstimate(shibuya, oshiage, "2026-10-09T21:59:00");
    const night = taxiEstimate(shibuya, oshiage, "2026-10-09T22:00:00");
    const afterMidnight = taxiEstimate(shibuya, oshiage, "2026-10-10T00:20:00");
    const morning = taxiEstimate(shibuya, oshiage, "2026-10-10T05:00:00");
    expect(night.fareYen).toBe(Math.round(day.fareYen! * 1.2));
    expect(afterMidnight.fareYen).toBe(night.fareYen);
    expect(morning.fareYen).toBe(day.fareYen);
    expect(night.minutes).toBe(day.minutes);
  });

  it("falls back to the current Japan time without a start time", () => {
    // 2026-10-09 23:30 JST = 14:30 UTC.
    const lateNow = Date.parse("2026-10-09T14:30:00Z");
    expect(taxiEstimate(shibuya, shibuya, undefined, lateNow)).toEqual({
      distanceMeters: 0,
      minutes: 2,
      fareYen: 600,
    });
    const noon = Date.parse("2026-10-09T03:00:00Z");
    expect(taxiEstimate(shibuya, shibuya, undefined, noon).fareYen).toBe(500);
  });
});
