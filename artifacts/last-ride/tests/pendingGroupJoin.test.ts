import { beforeEach, describe, expect, test, vi } from "vitest";

const { store, random, failWrite } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  random: vi.fn(async () => Uint8Array.from(Array.from({ length: 32 }, (_, i) => 255 - i))),
  failWrite: { current: false },
}));
vi.mock("expo-crypto", () => ({ getRandomBytesAsync: random }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {
  getItem: vi.fn(async (key: string) => store.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => {
    if (failWrite.current) { failWrite.current = false; throw new Error("disk full"); }
    store.set(key, value);
  }),
  removeItem: vi.fn(async (key: string) => { store.delete(key); }),
} }));
import { prepareGroupJoin, prepareReadableGroupJoin, readPendingGroupJoin, finishGroupJoin, joinDefinitelyRejected } from "@/lib/pendingGroupJoin";

beforeEach(async () => {
  const existing = await readPendingGroupJoin();
  if (existing) await finishGroupJoin(existing.joinKey);
  store.clear(); failWrite.current = false; random.mockClear();
});

const entry = { joinCode: "ABCD1234", displayName: "Alice", language: "ja" as const };

describe("pending anonymous group join recovery", () => {
  test("invalid or full invites can be retried with corrected input", () => {
    expect([400, 409].map(joinDefinitelyRejected)).toEqual([true, true]);
    expect([undefined, 0, 500, 503, 401].map(joinDefinitelyRejected)).toEqual([false, false, false, false, false]);
  });
  test("generates 32 secure random bytes and stores a replayable capability before request", async () => {
    const pending = await prepareGroupJoin(entry);
    expect(pending.joinKey).toMatch(/^[a-f0-9]{64}$/);
    expect(await readPendingGroupJoin()).toEqual(pending);
    expect((await prepareGroupJoin(entry)).joinKey).toBe(pending.joinKey);
    expect(random).toHaveBeenCalledTimes(1);
  });
  test("20 parallel requests keep exactly one anonymous member key", async () => {
    const pending = await Promise.all(Array.from({ length: 20 }, () => prepareGroupJoin(entry)));
    expect(new Set(pending.map((x) => x.joinKey)).size).toBe(1);
    expect(random).toHaveBeenCalledTimes(1);
  });
  test("never overwrites an incomplete join when the invite differs", async () => {
    const pending = await prepareGroupJoin(entry);
    await expect(prepareGroupJoin({ ...entry, joinCode: "DIFF1234" })).rejects.toThrow("PENDING_GROUP_JOIN");
    expect(await readPendingGroupJoin()).toEqual(pending);
  });
  test("missing restored Keystore access cannot create a blocking pending join", async () => {
    const unreadable = vi.fn(async (): Promise<string[]> => {
      throw new Error("Saved group capability is missing");
    });
    await expect(prepareReadableGroupJoin(entry, unreadable))
      .rejects.toThrow("Saved group capability is missing");
    expect(random).not.toHaveBeenCalled();
    expect(await readPendingGroupJoin()).toBeNull();
    // Local recovery can clear saved credentials before a fresh invitation.
    const usable = await prepareReadableGroupJoin(entry, async () => []);
    expect(usable.knownMemberTokens).toEqual([]);
    expect(await readPendingGroupJoin()).toEqual(usable.pending);
  });

  test("existing tokens are capped and the original retryable join key is preserved", async () => {
    const tokens = Array.from({ length: 65 }, (_, index) => "member-" + index);
    const first = await prepareReadableGroupJoin(entry, async () => tokens);
    const second = await prepareReadableGroupJoin(entry, async () => tokens);
    expect(first.knownMemberTokens).toHaveLength(50);
    expect(first.knownMemberTokens[49]).toBe("member-49");
    expect(first.pending.joinKey).toBe(second.pending.joinKey);
    expect(random).toHaveBeenCalledTimes(1);
  });

  test("no join request is safe when the first persistent write fails", async () => {
    failWrite.current = true;
    await expect(prepareGroupJoin(entry)).rejects.toThrow("disk full");
    expect(await readPendingGroupJoin()).toBeNull();
  });
  test("only matching completed member capability clears pending join", async () => {
    const pending = await prepareGroupJoin(entry);
    await finishGroupJoin("wrong");
    expect(await readPendingGroupJoin()).toEqual(pending);
    await finishGroupJoin(pending.joinKey);
    expect(await readPendingGroupJoin()).toBeNull();
  });
});
