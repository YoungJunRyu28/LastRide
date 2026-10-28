import { describe, expect, it } from "vitest";
import { FixedWindowLimiter } from "../src/lib/rateLimit";
import {
  groupJoinAttemptRateKey,
  GROUP_JOIN_ATTEMPT_LIMIT,
  GROUP_JOIN_IP_LIMIT,
} from "../src/lib/groupJoinRateLimit";

const address = "198.51.100.42";
const key = (number: number) => number.toString(16).padStart(64, "0");

describe("group join fairness behind campus or venue NAT", () => {
  it("accepts 50 distinct idempotent attendees on one shared IP within a minute", () => {
    const shared = new FixedWindowLimiter(GROUP_JOIN_IP_LIMIT, 60_000);
    const perAttempt = new FixedWindowLimiter(GROUP_JOIN_ATTEMPT_LIMIT, 60_000);
    for (let i = 0; i < 50; i += 1) {
      expect(shared.check("groups-join-ip:" + address, 1_000).allowed).toBe(true);
      expect(perAttempt.check(groupJoinAttemptRateKey(address, key(i)), 1_000).allowed).toBe(true);
    }
  });

  it("still limits repeated tries with the same join key to 20/min", () => {
    const limit = new FixedWindowLimiter(GROUP_JOIN_ATTEMPT_LIMIT, 60_000);
    for (let i = 0; i < 20; i += 1) {
      expect(limit.check(groupJoinAttemptRateKey(address, key(42)), 1_000).allowed).toBe(true);
    }
    expect(limit.check(groupJoinAttemptRateKey(address, key(42)), 1_000).allowed).toBe(false);
  });

  it("caps new random join keys across one address so they cannot avoid the aggregate budget", () => {
    const limit = new FixedWindowLimiter(GROUP_JOIN_IP_LIMIT, 60_000);
    for (let i = 0; i < GROUP_JOIN_IP_LIMIT; i += 1) {
      expect(limit.check("groups-join-ip:" + address, 1_000).allowed).toBe(true);
    }
    expect(limit.check("groups-join-ip:" + address, 1_000).allowed).toBe(false);
  });

  it("keeps old or invalid-key clients on the shared 20/min limiter", () => {
    expect(groupJoinAttemptRateKey(address, undefined)).toBe("groups-join-legacy:" + address);
    expect(groupJoinAttemptRateKey(address, "not-a-key")).toBe("groups-join-legacy:" + address);
    expect(groupJoinAttemptRateKey(address, key(7))).toBe(groupJoinAttemptRateKey(address, key(7).toUpperCase()));
    expect(groupJoinAttemptRateKey("198.51.100.43", key(7))).not.toBe(groupJoinAttemptRateKey(address, key(7)));
    expect(groupJoinAttemptRateKey(address, key(7))).not.toContain(key(7));
  });
});
