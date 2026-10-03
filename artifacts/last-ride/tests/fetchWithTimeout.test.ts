import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";

describe("fetchWithTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("aborts the request once the timeout elapses", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: string, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }),
    );

    const request = fetchWithTimeout("https://example.invalid", 8_000);
    const assertion = expect(request).rejects.toThrow("aborted");
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(8_000);
    await assertion;
    expect(signal?.aborted).toBe(true);
  });

  it("clears the timer when the response arrives in time", async () => {
    const response = new Response("ok");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );

    await expect(
      fetchWithTimeout("https://example.invalid", 8_000),
    ).resolves.toBe(response);
    expect(vi.getTimerCount()).toBe(0);
  });
});
