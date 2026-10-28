import { describe, expect, it } from "vitest";
import {
  atExpression,
  parseAtExpression,
  shouldMoveSchedule,
  watchdogUntil,
  WATCHDOG_RATE,
  WATCHDOG_TAIL_MS,
} from "../src/lib/leaveAlertSchedule";

const now = new Date("2026-10-14T13:00:00Z");
const minutes = (count: number) => new Date(now.getTime() + count * 60_000);

describe("one-time schedule expressions", () => {
  it("writes and reads EventBridge's at(...) form in UTC, to the second", () => {
    const at = new Date("2026-10-14T14:31:00.000Z");
    expect(atExpression(at)).toBe("at(2026-10-14T14:31:00)");
    expect(parseAtExpression(atExpression(at))).toEqual(at);
  });

  it("ignores expressions that aren't one-time", () => {
    expect(parseAtExpression("rate(1 minute)")).toBeNull();
    expect(parseAtExpression(undefined)).toBeNull();
  });
});

describe("moving the schedule", () => {
  it("always sets it when nothing is pending (missing or already run)", () => {
    expect(shouldMoveSchedule(null, minutes(30), now, true)).toBe(true);
    expect(shouldMoveSchedule(minutes(-5), minutes(30), now, true)).toBe(true);
  });

  it("a leave-time write only moves a pending schedule earlier", () => {
    // Someone's alert at +10 is pending; another member's at +30 mustn't delay it.
    expect(shouldMoveSchedule(minutes(10), minutes(30), now, true)).toBe(false);
    expect(shouldMoveSchedule(minutes(30), minutes(10), now, true)).toBe(true);
  });

  it("the scheduled run moves on to the next alert, even if later", () => {
    expect(shouldMoveSchedule(minutes(10), minutes(30), now, false)).toBe(true);
  });

  it("leaves it alone when it already points at that time", () => {
    expect(shouldMoveSchedule(minutes(10), minutes(10), now, false)).toBe(false);
  });
});

describe("the on-demand watchdog", () => {
  it("runs until 15 minutes after the last pending alert", () => {
    const last = new Date("2026-10-14T14:30:00Z");
    expect(watchdogUntil(last, null, now)?.toISOString()).toBe("2026-10-14T14:45:00.000Z");
  });
  it("isn't started when no alert is pending (a quiet night leaves the database asleep)", () => {
    expect(watchdogUntil(null, null, now)).toBeNull();
  });
  it("is extended for a later alert, never shortened", () => {
    const end = new Date("2026-10-14T14:45:00Z");
    expect(watchdogUntil(new Date("2026-10-14T14:00:00Z"), end, now)).toBeNull();
    expect(watchdogUntil(new Date("2026-10-14T15:00:00Z"), end, now)?.toISOString()).toBe("2026-10-14T15:15:00.000Z");
  });
  it("checks every 5 minutes, inside the 10-minute alert window", () => {
    expect(WATCHDOG_RATE).toBe("rate(5 minutes)");
    expect(WATCHDOG_TAIL_MS).toBe(15 * 60_000);
  });
});

