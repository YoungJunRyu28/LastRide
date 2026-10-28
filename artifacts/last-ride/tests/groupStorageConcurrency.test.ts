import { beforeEach, describe, expect, test, vi } from "vitest";

const { store, secure, failNextWrite, failNextRead, failSecureWrite, failSecureDelete, failMultiRemove, secureAvailable } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  secure: new Map<string, string>(),
  failNextWrite: { current: false },
  failNextRead: { current: false },
  failSecureWrite: { current: false },
  failSecureDelete: { current: false },
  failMultiRemove: { current: false },
  secureAvailable: { current: true },
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
    multiRemove: vi.fn(async (keys: string[]) => {
      if (failMultiRemove.current) {
        failMultiRemove.current = false;
        store.delete(keys[0]);
        throw new Error("Interrupted AsyncStorage batch");
      }
      keys.forEach((key) => store.delete(key));
    }),
  },
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK: "AFTER_FIRST_UNLOCK",
  isAvailableAsync: vi.fn(async () => secureAvailable.current),
  getItemAsync: vi.fn(async (key: string) => secure.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    if (failSecureWrite.current) {
      failSecureWrite.current = false;
      throw new Error("Keychain write failure");
    }
    secure.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    if (failSecureDelete.current) {
      failSecureDelete.current = false;
      throw new Error("Interrupted Keychain deletion");
    }
    secure.delete(key);
  }),
}));
vi.mock("expo-crypto", async () => {
  const { createHash } = await import("node:crypto");
  return {
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    digestStringAsync: vi.fn(async (_algorithm: string, input: string) =>
      createHash("sha256").update(input).digest("hex")),
  };
});
vi.mock("@workspace/api-client-react", () => ({ joinGroupTonight: vi.fn() }));

import {
  saveMembership, readMemberships, renameMembership, removeMembership, clearMemberships,
} from "@/lib/groupMemberships";
import { markSharing, stopSharing, clearSharing } from "@/lib/groupSharing";

beforeEach(async () => {
  // Each test gets a fresh sandbox, including cases that intentionally delete
  // secure capabilities or make Keychain access unavailable.
  store.clear();
  secure.clear();
  secureAvailable.current = true;
  failSecureWrite.current = false;
  failSecureDelete.current = false;
  failMultiRemove.current = false;
  failNextWrite.current = false;
  failNextRead.current = false;
  await clearSharing();
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

  test("native memberships never store member tokens in AsyncStorage", async () => {
    await saveMembership({ groupId: "secret-group", memberToken: "private-capability", name: "Friends" });
    expect(store.has("lastride-group-memberships")).toBe(false);
    expect(JSON.stringify([...store.entries()])).not.toContain("private-capability");
    expect(secure.size).toBe(1);
    expect([...secure.values()]).toEqual(["private-capability"]);
    expect(await readMemberships()).toEqual([
      { groupId: "secret-group", memberToken: "private-capability", name: "Friends" },
    ]);
    await clearMemberships();
    expect(secure.size).toBe(0);
    expect(store.has("lastride-group-memberships-v2")).toBe(false);
  });

  test("migrates old plaintext groups before deleting the backup and survives a restart", async () => {
    store.set("lastride-group-memberships", JSON.stringify([
      { groupId: "old", name: "Old Group", memberToken: "legacy-capability" },
    ]));
    expect(await readMemberships()).toEqual([
      { groupId: "old", name: "Old Group", memberToken: "legacy-capability" },
    ]);
    expect(store.has("lastride-group-memberships")).toBe(false);
    expect(JSON.stringify([...store.entries()])).not.toContain("legacy-capability");
    expect(await readMemberships()).toHaveLength(1);
    expect([...secure.values()]).toContain("legacy-capability");
  });

  test("legacy group migration tolerates a failed AsyncStorage index write", async () => {
    const legacy = [{ groupId: "old", name: "Old Group", memberToken: "persistent-secret" }];
    store.set("lastride-group-memberships", JSON.stringify(legacy));
    failNextWrite.current = true;
    await expect(readMemberships()).rejects.toThrow("storage failure");
    expect(store.get("lastride-group-memberships")).toBe(JSON.stringify(legacy));
    expect(store.has("lastride-group-memberships-v2")).toBe(false);
    expect(await readMemberships()).toEqual(legacy);
    expect(store.has("lastride-group-memberships")).toBe(false);
  });

  test("web-only membership fallback retains legacy behavior without Keychain", async () => {
    const { Platform } = await import("react-native");
    const previous = Platform.OS;
    (Platform as { OS: string }).OS = "web";
    try {
      await saveMembership({ groupId: "web", name: "Web Group", memberToken: "web-token" });
      expect((await readMemberships())[0].memberToken).toBe("web-token");
      expect(store.get("lastride-group-memberships")).toContain("web-token");
      expect(secure.size).toBe(0);
    } finally {
      (Platform as { OS: string }).OS = previous;
    }
  });

  test("failed secure migration preserves old tokens and can be retried", async () => {
    store.set("lastride-group-memberships", JSON.stringify([
      { groupId: "old", name: "Old Group", memberToken: "legacy-capability" },
    ]));
    failSecureWrite.current = true;
    await expect(readMemberships()).rejects.toThrow("Keychain write failure");
    expect(store.has("lastride-group-memberships")).toBe(true);
    expect(store.has("lastride-group-memberships-v2")).toBe(false);
    expect((await readMemberships())[0].memberToken).toBe("legacy-capability");
    expect(store.has("lastride-group-memberships")).toBe(false);
  });

  test("failed rejoin index update leaves the previous token valid", async () => {
    await saveMembership({ groupId: "rejoin", memberToken: "original-token", name: "Friends" });
    failNextWrite.current = true;
    await expect(saveMembership({ groupId: "rejoin", memberToken: "replacement-token", name: "Friends" }))
      .rejects.toThrow("storage failure");
    expect((await readMemberships())[0].memberToken).toBe("original-token");
    expect([...secure.values()]).toContain("original-token");
  });

  test("failed post-commit secure delete preserves success and later cleans the orphan", async () => {
    await saveMembership({ groupId: "old", name: "Old", memberToken: "old-secret" });
    failSecureDelete.current = true;
    await removeMembership("old");
    expect(store.get("lastride-group-memberships-v2")).toBe("[]");
    expect(secure.size).toBe(1);
    expect(store.has("lastride-group-memberships-retired-v1")).toBe(true);
    // Reading after the Keychain recovers retries the secure deletion.
    expect(await readMemberships()).toEqual([]);
    expect(secure.size).toBe(0);
    expect(store.has("lastride-group-memberships-retired-v1")).toBe(false);
  });

  test("interrupted index update never destroys still-active secure credentials", async () => {
    await saveMembership({ groupId: "active", name: "A", memberToken: "active-secret" });
    failNextWrite.current = true;
    // The pre-commit retire journal write fails; previous token stays intact.
    await expect(removeMembership("active")).rejects.toThrow("storage failure");
    expect((await readMemberships())[0].memberToken).toBe("active-secret");
    // A later index failure after the journal was staged is also safe.
    const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
    const original = vi.mocked(AsyncStorage.setItem);
    const initial = original.getMockImplementation()!;
    original.mockImplementationOnce(async (key: string, value: string) => {
      if (key !== "lastride-group-memberships-retired-v1") throw new Error("Incorrect journal order");
      store.set(key, value);
    }).mockImplementationOnce(async () => { throw new Error("Index write interrupted"); });
    await expect(removeMembership("active")).rejects.toThrow("Index write interrupted");
    original.mockImplementation(initial);
    expect((await readMemberships())[0].memberToken).toBe("active-secret");
    expect(secure.size).toBe(1);
    expect(store.has("lastride-group-memberships-retired-v1")).toBe(false);
  });

  test("missing native capability fails closed, not overwritten by a new join", async () => {
    await saveMembership({ groupId: "first", name: "Friends", memberToken: "keep-me" });
    secure.clear();
    await expect(saveMembership({ groupId: "second", name: "Other", memberToken: "new-token" }))
      .rejects.toThrow("Saved group capability is missing");
    expect(store.get("lastride-group-memberships-v2")).toContain("first");
    expect(store.get("lastride-group-memberships-v2")).not.toContain("second");
  });

  test("reset works after Android restore loses Keystore tokens", async () => {
    await saveMembership({ groupId: "restored", name: "Old phone", memberToken: "lost-key" });
    secure.clear();
    await expect(readMemberships()).rejects.toThrow("Saved group capability is missing");
    await clearMemberships();
    expect(await readMemberships()).toEqual([]);
    await saveMembership({ groupId: "fresh", name: "New phone", memberToken: "new-key" });
    expect((await readMemberships())[0].memberToken).toBe("new-key");
  });

  test("resumes a reset interrupted by a failed secure deletion without orphaning credentials", async () => {
    await saveMembership({ groupId: "a", name: "A", memberToken: "secret-a" });
    await saveMembership({ groupId: "b", name: "B", memberToken: "secret-b" });
    failSecureDelete.current = true;
    await expect(clearMemberships()).rejects.toThrow("Interrupted Keychain deletion");
    expect(store.has("lastride-group-memberships-clear-pending-v1")).toBe(true);
    // An ordinary read on the next launch completes the recorded reset.
    expect(await readMemberships()).toEqual([]);
    expect(secure.size).toBe(0);
    expect(store.has("lastride-group-memberships-v2")).toBe(false);
    expect(store.has("lastride-group-memberships-clear-pending-v1")).toBe(false);
  });

  test("recovers when an AsyncStorage reset batch only partially deleted keys", async () => {
    await saveMembership({ groupId: "a", name: "A", memberToken: "secret-a" });
    failMultiRemove.current = true;
    await expect(clearMemberships()).rejects.toThrow("Interrupted AsyncStorage batch");
    expect(store.has("lastride-group-memberships-clear-pending-v1")).toBe(true);
    expect(await readMemberships()).toEqual([]);
    expect(secure.size).toBe(0);
    await saveMembership({ groupId: "new", name: "N", memberToken: "secret-new" });
    expect((await readMemberships()).map((entry) => entry.groupId)).toEqual(["new"]);
  });

  test("a failed reset marker write does not delete or lose any capability", async () => {
    await saveMembership({ groupId: "a", name: "A", memberToken: "secret-a" });
    failNextWrite.current = true;
    await expect(clearMemberships()).rejects.toThrow("storage failure");
    expect((await readMemberships())[0].memberToken).toBe("secret-a");
    expect(secure.size).toBe(1);
  });

  test("missing secure storage does not downgrade native tokens to plaintext", async () => {
    secureAvailable.current = false;
    await expect(saveMembership({ groupId: "first", name: "Friends", memberToken: "keep-me" }))
      .rejects.toThrow("Secure device storage is required");
    expect(store.has("lastride-group-memberships")).toBe(false);
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

  test("failed rename retains the previous saved name and token for retry", async () => {
    await saveMembership({ groupId: "rename", name: "Old", memberToken: "host-secret" });
    failNextWrite.current = true;
    await expect(renameMembership("rename", "New")).rejects.toThrow("storage failure");
    expect(await readMemberships()).toEqual([
      { groupId: "rename", name: "Old", memberToken: "host-secret" },
    ]);
    await renameMembership("rename", "New");
    expect(await readMemberships()).toEqual([
      { groupId: "rename", name: "New", memberToken: "host-secret" },
    ]);
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
