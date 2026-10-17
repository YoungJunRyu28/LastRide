/** Persist anonymous membership capability before sending the join request. */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getRandomBytesAsync } from "expo-crypto";

const STORAGE_KEY = "lastride-pending-group-join";
let tail: Promise<void> = Promise.resolve();

export type PendingGroupJoin = {
  inviteToken?: string;
  joinCode?: string;
  displayName: string;
  language: "ja" | "en";
  joinKey: string;
};

function valid(input: unknown): input is PendingGroupJoin {
  const x = input as Partial<PendingGroupJoin> | null;
  return !!x && typeof x.displayName === "string" && x.displayName.length > 0 &&
    (x.language === "en" || x.language === "ja") &&
    typeof x.joinKey === "string" && /^[a-f0-9]{64}$/i.test(x.joinKey) &&
    ((typeof x.inviteToken === "string" && x.inviteToken.length > 0) ||
     (typeof x.joinCode === "string" && x.joinCode.length > 0));
}

async function read(): Promise<PendingGroupJoin | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const result: unknown = JSON.parse(raw);
  if (!valid(result)) throw new Error("Invalid pending group join state");
  return result;
}

async function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const result = tail.then(fn);
  tail = result.then(() => undefined, () => undefined);
  return result;
}

export async function readPendingGroupJoin(): Promise<PendingGroupJoin | null> {
  await tail;
  return read();
}

export async function prepareGroupJoin(input: {
  inviteToken?: string; joinCode?: string; displayName: string; language: "ja" | "en";
}): Promise<PendingGroupJoin> {
  return serialized(async () => {
    const old = await read();
    if (old) {
      if (old.inviteToken !== input.inviteToken || old.joinCode !== input.joinCode ||
          old.displayName !== input.displayName) throw new Error("PENDING_GROUP_JOIN");
      return old;
    }
    const key = await getRandomBytesAsync(32);
    const joinKey = Array.from(key, (value) => value.toString(16).padStart(2, "0")).join("");
    const pending = { ...input, joinKey };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
    return pending;
  });
}

export async function finishGroupJoin(joinKey: string): Promise<void> {
  await serialized(async () => {
    const pending = await read();
    if (pending?.joinKey === joinKey) await AsyncStorage.removeItem(STORAGE_KEY);
  });
}
