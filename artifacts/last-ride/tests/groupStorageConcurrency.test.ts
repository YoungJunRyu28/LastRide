import { beforeEach, describe, expect, test, vi } from "vitest";

const { store, failNextWrite, failNextRead } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  failNextWrite: { current: false },
  failNextRead: { current: false },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => {
      if (failNextRead.current) {
        failNextRead.current = false;
        throw new Error("read failure");
      }
      return store.get(key) ?? null;
    }),
    setItem: vi.fn(async (key: string, value: string) => {
      if (failNextWrite.current) {
        failNextWrite.current = false;
        throw new Error("storage failure");
      }
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => { store.delete(key); }),
    multiRemove: vi.fn(async (keys: string[]) => { keys.forEach((key) => store.delete(key)); }),
  },
}));
vi.mock("@workspace/api-client-react", () => ({ joinGroupTonight: vi.fn() }));

import {
  saveMembership, readMemberships, renameMembership, removeMembership, clearMemberships,
} from "@/lib/groupMemberships";
import { markSharing, stopSharing, clearSharing } from "@/lib/groupSharing";

beforeEach(async () => {
  await clearMemberships();
  await clearSharing();
  store.clear();
  failNextWrite.current = false;
  failNextRead.current = false;
});

describe("group membership storage is atomic within a device", () => {
  test("20 concurrent joins persist all group capability tokens", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) =>
      saveMembership({ groupId: `g${i}`, memberToken: `token${i}`, name: `Group ${i}` }),
    ));
    const memberships = await readMemberships();
    expect(memberships).toHaveLength(20);
    for (let i = 0; i < 20; i++) {
      expect(memberships.find((m) => m.groupId === `g${i}`)?.memberToken).toBe(`token${i}`);
    }
  });

  test("rename, removal, and reset serialize with pending joins", async () => {
    await Promise.all([
      saveMembership({ groupId: "a", memberToken: "a-token", name: "A" }),
      saveMembership({ groupId: "b", memberToken: "b-token", name: "B" }),
      renameMembership("a", "Renamed"),
      removeMembership("b"),
    ]);
    expect(await readMemberships()).toEqual([
      { groupId: "a", memberToken: "a-token", name: "Renamed" },
    ]);
    await Promise.all([
      saveMembership({ groupId: "c", memberToken: "c-token", name: "C" }),
      clearMemberships(),
    ]);
    expect(await readMemberships()).toEqual([]);
  });

  test("a transient read failure does not destroy existing capability tokens", async () => {
    await saveMembership({ groupId: "existing", memberToken: "secret", name: "Old" });
    failNextRead.current = true;
    await expect(saveMembership({ groupId: "new", memberToken: "new", name: "New" })).rejects.toThrow();
    expect(await readMemberships()).toEqual([
      { groupId: "existing", memberToken: "secret", name: "Old" },
    ]);
  });

  test("a failed save rejects but does not poison future queued mutations", async () => {
    failNextWrite.current = true;
    await expect(saveMembership({ groupId: "bad", memberToken: "bad", name: "Bad" })).rejects.toThrow();
    await saveMembership({ groupId: "good", memberToken: "good", name: "Good" });
    expect((await readMemberships()).map((m) => m.groupId)).toEqual(["good"]);
  });
});

describe("background group sharing storage is atomic within a device", () => {
  test("20 overlapping marks persist for all groups", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => markSharing(`g${i}`, null)));
    expect(Object.keys(JSON.parse(store.get("lastride-group-sharing") ?? "{}"))).toHaveLength(20);
  });

  test("a transient sharing read failure preserves existing active groups", async () => {
    await markSharing("existing", null);
    failNextRead.current = true;
    await expect(markSharing("new", null)).rejects.toThrow();
    expect(JSON.parse(store.get("lastride-group-sharing") ?? "{}")).toEqual({ existing: null });
  });

  test("stop, add, and clear execute in order", async () => {
    await Promise.all([markSharing("a", null), markSharing("b", null), stopSharing("a")]);
    expect(JSON.parse(store.get("lastride-group-sharing") ?? "{}")).toEqual({ b: null });
    await Promise.all([markSharing("c", null), clearSharing()]);
    expect(store.has("lastride-group-sharing")).toBe(false);
  });
});
