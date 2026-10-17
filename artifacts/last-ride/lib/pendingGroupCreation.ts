/**
 * Before creating a paid group, persist its random host/creation capability.
 * Never discard it on timeout: the server might already have committed.
 * A retry uses exactly the same token, recovering rather than orphaning a host.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getRandomBytesAsync } from "expo-crypto";

const PENDING_KEY = "lastride-pending-group-creation";
let mutations: Promise<void> = Promise.resolve();

export type PendingGroupCreation = {
  name: string;
  displayName: string;
  language: "ja" | "en";
  creationKey: string;
};

function valid(value: unknown): value is PendingGroupCreation {
  const record = value as Partial<PendingGroupCreation> | null;
  return !!record && typeof record.name === "string" && record.name.length > 0 &&
    typeof record.displayName === "string" && record.displayName.length > 0 &&
    (record.language === "ja" || record.language === "en") &&
    typeof record.creationKey === "string" && /^[a-f0-9]{64}$/i.test(record.creationKey);
}

async function readStrict(): Promise<PendingGroupCreation | null> {
  const raw = await AsyncStorage.getItem(PENDING_KEY);
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!valid(parsed)) throw new Error("Invalid persisted group creation state");
  return parsed;
}

async function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutations.then(operation);
  mutations = result.then(() => undefined, () => undefined);
  return result;
}

export async function readPendingGroupCreation(): Promise<PendingGroupCreation | null> {
  await mutations;
  return readStrict();
}

export async function prepareGroupCreation(
  name: string, displayName: string, language: "ja" | "en",
): Promise<PendingGroupCreation> {
  return serialize(async () => {
    const existing = await readStrict();
    if (existing) {
      if (existing.name !== name || existing.displayName !== displayName)
        throw new Error("PENDING_GROUP_CREATION");
      return existing;
    }
    // getRandomBytesAsync uses a native secure RNG. Math.random, timestamps
    // and UUID v4 polyfills are deliberately not accepted as capabilities.
    const bytes = await getRandomBytesAsync(32);
    const creationKey = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const pending = { name, displayName, language, creationKey };
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    return pending;
  });
}

/** Clear only the operation that was successfully persisted in memberships. */
export async function finishGroupCreation(creationKey: string): Promise<void> {
  await serialize(async () => {
    const pending = await readStrict();
    if (pending?.creationKey === creationKey) await AsyncStorage.removeItem(PENDING_KEY);
  });
}
