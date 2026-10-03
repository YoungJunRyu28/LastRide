import { describe, expect, it, vi } from "vitest";
import { ProviderError } from "../src/lib/cache";
import {
  CircuitBreaker,
  ProviderOutageError,
} from "../src/lib/circuitBreaker";

function breakerWithClock() {
  let nowMs = 1_000_000;
  const breaker = new CircuitBreaker("test-provider", {
    failureThreshold: 3,
    cooldownMs: 30_000,
    now: () => nowMs,
  });
  return { breaker, advance: (ms: number) => (nowMs += ms) };
}

const outage = () => Promise.reject(new ProviderOutageError("timeout"));

describe("CircuitBreaker", () => {
  it("opens after consecutive outages and fails fast without calling the provider", async () => {
    const { breaker } = breakerWithClock();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(breaker.run(outage)).rejects.toBeInstanceOf(ProviderOutageError);
    }

    const provider = vi.fn(async () => "ok");
    const failFast = breaker.run(provider);
    await expect(failFast).rejects.toBeInstanceOf(ProviderError);
    await expect(failFast).rejects.not.toBeInstanceOf(ProviderOutageError);
    expect(provider).not.toHaveBeenCalled();
  });

  it("ignores client errors and quota refusals", async () => {
    const { breaker } = breakerWithClock();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        breaker.run(() => Promise.reject(new ProviderError("responded 400"))),
      ).rejects.toThrow("responded 400");
    }
    await expect(breaker.run(async () => "ok")).resolves.toBe("ok");
  });

  it("a success resets the consecutive-failure count", async () => {
    const { breaker } = breakerWithClock();
    await expect(breaker.run(outage)).rejects.toThrow();
    await expect(breaker.run(outage)).rejects.toThrow();
    await breaker.run(async () => "ok");
    await expect(breaker.run(outage)).rejects.toThrow();
    await expect(breaker.run(outage)).rejects.toThrow();
    await expect(breaker.run(async () => "ok")).resolves.toBe("ok");
  });

  it("half-opens after the cooldown: one trial closes or re-opens the circuit", async () => {
    const { breaker, advance } = breakerWithClock();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(breaker.run(outage)).rejects.toThrow();
    }

    advance(30_000);
    const trial = vi.fn(outage);
    await expect(breaker.run(trial)).rejects.toBeInstanceOf(ProviderOutageError);
    expect(trial).toHaveBeenCalledTimes(1);

    // The failed trial re-opened the circuit for another cooldown.
    const blocked = vi.fn(async () => "ok");
    await expect(breaker.run(blocked)).rejects.toThrow("temporarily unavailable");
    expect(blocked).not.toHaveBeenCalled();

    advance(30_000);
    await expect(breaker.run(async () => "recovered")).resolves.toBe("recovered");
    await expect(breaker.run(async () => "closed")).resolves.toBe("closed");
  });

  it("lets only one trial call through while half-open", async () => {
    const { breaker, advance } = breakerWithClock();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(breaker.run(outage)).rejects.toThrow();
    }
    advance(30_000);

    let finishTrial!: (value: string) => void;
    const trial = breaker.run(
      () => new Promise<string>((resolve) => (finishTrial = resolve)),
    );
    const concurrent = vi.fn(async () => "ok");
    await expect(breaker.run(concurrent)).rejects.toThrow("temporarily unavailable");
    expect(concurrent).not.toHaveBeenCalled();

    finishTrial("done");
    await expect(trial).resolves.toBe("done");
  });
});
