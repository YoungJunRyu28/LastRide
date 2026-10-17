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
import { prepareGroupJoin, readPendingGroupJoin, finishGroupJoin } from "@/lib/pendingGroupJoin";

beforeEach(async () => {
  const existing = await readPendingGroupJoin();
  if (existing) await finishGroupJoin(existing.joinKey);
  store.clear(); failWrite.current = false; random.mockClear();
});

const entry = { joinCode: "ABCD1234", displayName: "Alice", language: "ja" as const };

describe("pending anonymous group join recovery", () => {
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
