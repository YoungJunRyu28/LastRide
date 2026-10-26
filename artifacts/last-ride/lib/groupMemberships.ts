/**
 * The groups this device belongs to. There are no accounts: each group gave
 * this device a member token (a capability), kept here. AsyncStorage lives in
 * the app's data, which iCloud / Android backup include, so memberships come
 * back with a restored phone.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const MEMBERSHIPS_KEY = "lastride-group-memberships";
const DISPLAY_NAME_KEY = "lastride-group-display-name";

// AsyncStorage has no atomic update operation. Queue the entire read/modify/write
// sequence so two overlapping joins, renames, resets or removals cannot erase
// one another. A failed write must not poison subsequent operations.
let mutationTail: Promise<void> = Promise.resolve();

function serializeMutation<T>(work: () => Promise<T>): Promise<T> {
  const result = mutationTail.then(work);
  mutationTail = result.then(() => undefined, () => undefined);
  return result;
}

export type GroupMembership = {
  groupId: string;
  memberToken: string;
  /** Last known group name, for the list before the server answers. */
  name: string;
};

function valid(value: unknown): value is GroupMembership {
  const item = value as Partial<GroupMembership> | null;
  return (
    !!item &&
    typeof item.groupId === "string" &&
    typeof item.memberToken === "string" &&
    typeof item.name === "string"
  );
}

async function loadMemberships(strict = false): Promise<GroupMembership[]> {
  try {
    const raw = await AsyncStorage.getItem(MEMBERSHIPS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    // Never silently overwrite corrupt/unreadable stored capabilities with a
    // seemingly empty list during a write; the original can be recovered.
    if (!Array.isArray(parsed) || (strict && !parsed.every(valid)))
      throw new Error("Invalid stored group memberships");
    return parsed.filter(valid);
  } catch (error) {
    if (strict) throw error;
    return [];
  }
}

/** Public reads also wait for in-flight writes to finish. */
export async function readMemberships(): Promise<GroupMembership[]> {
  await mutationTail;
  return loadMemberships();
}

async function write(memberships: GroupMembership[]) {
  await AsyncStorage.setItem(MEMBERSHIPS_KEY, JSON.stringify(memberships));
}

/** Adds or replaces the membership for its group. */
export async function saveMembership(membership: GroupMembership): Promise<void> {
  await serializeMutation(async () => {
    const current = await loadMemberships(true);
    await write([...current.filter((item) => item.groupId !== membership.groupId), membership]);
  });
}

export async function renameMembership(groupId: string, name: string): Promise<void> {
  await serializeMutation(async () => {
    const current = await loadMemberships(true);
    await write(current.map((item) => (item.groupId === groupId ? { ...item, name } : item)));
  });
}

/** Forgets a group (left, removed or disbanded). */
export async function removeMembership(groupId: string): Promise<void> {
  await serializeMutation(async () => {
    const current = await loadMemberships(true);
    await write(current.filter((item) => item.groupId !== groupId));
  });
}

/** Forgets every group and the saved display name ("Reset & start over"). */
export async function clearMemberships(): Promise<void> {
  await serializeMutation(() => AsyncStorage.multiRemove([MEMBERSHIPS_KEY, DISPLAY_NAME_KEY]));
}

/** The name last used to join a group, offered as the default next time. */
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
