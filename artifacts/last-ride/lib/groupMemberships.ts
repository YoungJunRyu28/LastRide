/**
 * Group member tokens grant access to private leave-time sharing. Keep the
 * capabilities in the device Keychain / Android Keystore, not ordinary app
 * settings that can be included in plaintext backups and device diagnostics.
 *
 * The nonsecret group list stays in AsyncStorage. Existing memberships are
 * migrated before the legacy plaintext record is removed. Failures retain the
 * old record for recovery rather than silently logging users out.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import { Platform } from "react-native";

const LEGACY_KEY = "lastride-group-memberships";
const INDEX_KEY = "lastride-group-memberships-v2";
const DISPLAY_NAME_KEY = "lastride-group-display-name";
const PENDING_CLEAR_KEY = "lastride-group-memberships-clear-pending-v1";
const RETIRED_TOKENS_KEY = "lastride-group-memberships-retired-v1";
const SECURE_PREFIX = "lastride-group-member-v2-";
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

let mutationTail: Promise<void> = Promise.resolve();

function serializeMutation<T>(work: () => Promise<T>): Promise<T> {
  const result = mutationTail.then(work);
  mutationTail = result.then(() => undefined, () => undefined);
  return result;
}

export type GroupMembership = {
  groupId: string;
  memberToken: string;
  name: string;
};
type GroupIndex = Pick<GroupMembership, "groupId" | "name"> & { tokenRef: string };

function valid(value: unknown): value is GroupMembership {
  const item = value as Partial<GroupMembership> | null;
  return !!item && typeof item.groupId === "string" && item.groupId.length > 0 &&
    typeof item.memberToken === "string" && item.memberToken.length > 0 &&
    typeof item.name === "string";
}
function validIndex(value: unknown): value is GroupIndex {
  const item = value as Partial<GroupIndex> | null;
  return !!item && typeof item.groupId === "string" && item.groupId.length > 0 &&
    typeof item.name === "string" && typeof (item as Partial<GroupIndex>).tokenRef === "string" &&
    /^[a-f0-9]{64}$/.test((item as GroupIndex).tokenRef) && !("memberToken" in item);
}
function parseList<T>(raw: string | null, validate: (item: unknown) => item is T): T[] {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every(validate) ||
      new Set(parsed.map((item: T) => (item as GroupIndex).groupId)).size !== parsed.length) {
    throw new Error("Invalid stored group memberships");
  }
  return parsed;
}

async function secureReference(groupId: string, memberToken: string): Promise<string> {
  // Different tokens for the same group get distinct immutable secure keys.
  // A failed index write must NEVER overwrite a previously usable capability.
  // Hashing the 256-bit capability exposes no recoverable secret to AsyncStorage.
  return digestStringAsync(CryptoDigestAlgorithm.SHA256, groupId + "\0" + memberToken);
}

function secureKey(tokenRef: string): string {
  return SECURE_PREFIX + tokenRef;
}

async function usingNativeSecureStore(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  if (!(await SecureStore.isAvailableAsync()))
    throw new Error("Secure device storage is required for group memberships.");
  return true;
}

/** Pending secure deletes are nonsecret hashes, not membership tokens. */
function parseTokenRefs(raw: string | null): string[] {
  if (raw === null) return [];
  const refs: unknown = JSON.parse(raw);
  if (!Array.isArray(refs) ||
      !refs.every((ref) => typeof ref === "string" && /^[a-f0-9]{64}$/.test(ref)) ||
      refs.length > 1000) {
    throw new Error("Invalid group secure-storage cleanup journal.");
  }
  return [...new Set(refs)];
}

/**
 * A successful metadata commit must not be rolled back by a failed Keychain
 * deletion. Keep obsolete token refs in a durable cleanup journal and retry
 * on later reads. Never delete a reference still used by the live index.
 */
async function retireUnusedTokens(activeIndex: GroupIndex[]): Promise<void> {
  const pending = parseTokenRefs(await AsyncStorage.getItem(RETIRED_TOKENS_KEY));
  if (!pending.length) return;
  const active = new Set(activeIndex.map((entry) => entry.tokenRef));
  const remaining: string[] = [];
  for (const ref of pending) {
    if (active.has(ref)) continue;
    try {
      await SecureStore.deleteItemAsync(secureKey(ref), OPTIONS);
    } catch {
      remaining.push(ref);
    }
  }
  if (remaining.length) {
    await AsyncStorage.setItem(RETIRED_TOKENS_KEY, JSON.stringify(remaining));
  } else {
    await AsyncStorage.removeItem(RETIRED_TOKENS_KEY);
  }
}

/**
 * Complete a reset interrupted after some Keychain entries were deleted.
 * The marker is written BEFORE deleting capabilities and is removed LAST;
 * retries never mistake a half-finished reset for corrupt membership data.
 */
async function finishPendingClear(): Promise<void> {
  const raw = await AsyncStorage.getItem(PENDING_CLEAR_KEY);
  if (raw === null) return;
  const refs = parseTokenRefs(raw);
  for (const ref of refs) {
    await SecureStore.deleteItemAsync(secureKey(ref), OPTIONS);
  }
  // Do NOT remove the marker as part of multiRemove; native batches may fail
  // halfway. The next launch must still know that the reset was intentional.
  await AsyncStorage.multiRemove([LEGACY_KEY, INDEX_KEY, DISPLAY_NAME_KEY, RETIRED_TOKENS_KEY]);
  await AsyncStorage.removeItem(PENDING_CLEAR_KEY);
}

async function loadNative(): Promise<GroupMembership[]> {
  await finishPendingClear();
  let indexRaw = await AsyncStorage.getItem(INDEX_KEY);
  if (indexRaw === null) {
    const oldRaw = await AsyncStorage.getItem(LEGACY_KEY);
    if (oldRaw === null) return [];
    const legacy = parseList(oldRaw, valid);

    // Migration is retryable: until every Keychain write AND index write
    // succeed, the original plaintext record is preserved.
    const newIndex: GroupIndex[] = [];
    for (const item of legacy) {
      const tokenRef = await secureReference(item.groupId, item.memberToken);
      await SecureStore.setItemAsync(secureKey(tokenRef), item.memberToken, OPTIONS);
      newIndex.push({ groupId: item.groupId, name: item.name, tokenRef });
    }
    indexRaw = JSON.stringify(newIndex);
    await AsyncStorage.setItem(INDEX_KEY, indexRaw);
  }

  const index = parseList(indexRaw, validIndex);
  const memberships: GroupMembership[] = [];
  for (const item of index) {
    const token = await SecureStore.getItemAsync(secureKey(item.tokenRef), OPTIONS);
    if (!token) throw new Error("Saved group capability is missing; do not replace the group list.");
    // The index is non-secret, but must not point at a different capability.
    if (await secureReference(item.groupId, token) !== item.tokenRef)
      throw new Error("Saved group capability does not match its index.");
    memberships.push({ groupId: item.groupId, name: item.name, memberToken: token });
  }

  // Only erase the legacy backup AFTER reading back every secured token.
  // Also cleans up a crash between index commit and plaintext deletion.
  if (await AsyncStorage.getItem(LEGACY_KEY) !== null)
    await AsyncStorage.removeItem(LEGACY_KEY);
  // Credential cleanup is best effort: it must not strand valid groups.
  await retireUnusedTokens(index).catch(() => undefined);
  return memberships;
}

async function loadMemberships(strict = false): Promise<GroupMembership[]> {
  try {
    if (await usingNativeSecureStore()) return await loadNative();
    return parseList(await AsyncStorage.getItem(LEGACY_KEY), valid);
  } catch (error) {
    // Never overwrite unreadable capabilities during a mutation.
    if (strict) throw error;
    // A read failure is not evidence the member no longer belongs to a group.
    // UI callers should handle this rather than silently erasing memberships.
    throw error;
  }
}

export function readMemberships(): Promise<GroupMembership[]> {
  return serializeMutation(() => loadMemberships());
}

async function write(memberships: GroupMembership[]): Promise<void> {
  if (!(await usingNativeSecureStore())) {
    await AsyncStorage.setItem(LEGACY_KEY, JSON.stringify(memberships));
    return;
  }
  // Token changes go to secure storage BEFORE publishing the corresponding
  // index. A failed Keychain write never advertises a nonexistent membership.
  // Remove deleted tokens only after the new index is safely committed.
  const oldIndex = parseList(await AsyncStorage.getItem(INDEX_KEY), validIndex);
  const nextIndex: GroupIndex[] = [];
  for (const item of memberships) {
    const tokenRef = await secureReference(item.groupId, item.memberToken);
    nextIndex.push({ groupId: item.groupId, name: item.name, tokenRef });
    if (!oldIndex.some((old) => old.groupId === item.groupId && old.tokenRef === tokenRef)) {
      await SecureStore.setItemAsync(secureKey(tokenRef), item.memberToken, OPTIONS);
    }
  }
  const retired = oldIndex
    .filter((old) => !nextIndex.some((item) => item.tokenRef === old.tokenRef))
    .map((old) => old.tokenRef);
  if (retired.length) {
    // Journal deletion intent BEFORE committing the index. An interrupted
    // index write keeps its old token active, and cleanup checks that before
    // deleting anything.
    const pending = parseTokenRefs(await AsyncStorage.getItem(RETIRED_TOKENS_KEY));
    await AsyncStorage.setItem(RETIRED_TOKENS_KEY, JSON.stringify([...new Set([...pending, ...retired])]));
  }
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(nextIndex));
  await retireUnusedTokens(nextIndex).catch(() => undefined);
}

/** Adds or replaces the membership for its group. */
export function saveMembership(membership: GroupMembership): Promise<void> {
  if (!valid(membership)) return Promise.reject(new Error("Invalid group membership"));
  return serializeMutation(async () => {
    const current = await loadMemberships(true);
    await write([...current.filter((item) => item.groupId !== membership.groupId), membership]);
  });
}

export function renameMembership(groupId: string, name: string): Promise<void> {
  return serializeMutation(async () => {
    const current = await loadMemberships(true);
    await write(current.map((item) => (item.groupId === groupId ? { ...item, name } : item)));
  });
}

export function removeMembership(groupId: string): Promise<void> {
  return serializeMutation(async () => {
    const current = await loadMemberships(true);
    await write(current.filter((item) => item.groupId !== groupId));
  });
}

export function clearMemberships(): Promise<void> {
  return serializeMutation(async () => {
    if (await usingNativeSecureStore()) {
      await finishPendingClear();
      // A device restore can bring back the index but NOT Android Keystore
      // keys. Reset must work even when an indexed secret is already missing.
      const index = parseList(await AsyncStorage.getItem(INDEX_KEY), validIndex);
      const legacy = parseList(await AsyncStorage.getItem(LEGACY_KEY), valid);
      const keys = new Set(index.map((entry) => entry.tokenRef));
      for (const ref of parseTokenRefs(await AsyncStorage.getItem(RETIRED_TOKENS_KEY)))
        keys.add(ref);
      for (const entry of legacy)
        keys.add(await secureReference(entry.groupId, entry.memberToken));
      // Persist the intent before any secret is deleted, including zero keys.
      await AsyncStorage.setItem(PENDING_CLEAR_KEY, JSON.stringify([...keys]));
      await finishPendingClear();
      return;
    }
    await AsyncStorage.multiRemove([LEGACY_KEY, INDEX_KEY, DISPLAY_NAME_KEY]);
  });
}

export async function readDisplayName(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(DISPLAY_NAME_KEY)) ?? "";
  } catch {
    return "";
  }
}

export async function writeDisplayName(name: string): Promise<void> {
  await AsyncStorage.setItem(DISPLAY_NAME_KEY, name).catch(() => undefined);
}
