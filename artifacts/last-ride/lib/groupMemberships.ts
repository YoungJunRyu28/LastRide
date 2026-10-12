/**
 * The groups this device belongs to. There are no accounts: each group gave
 * this device a member token (a capability), kept here. AsyncStorage lives in
 * the app's data, which iCloud / Android backup include, so memberships come
 * back with a restored phone.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const MEMBERSHIPS_KEY = "lastride-group-memberships";
const DISPLAY_NAME_KEY = "lastride-group-display-name";

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

export async function readMemberships(): Promise<GroupMembership[]> {
  try {
    const raw = await AsyncStorage.getItem(MEMBERSHIPS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(valid) : [];
  } catch {
    return [];
  }
}

async function write(memberships: GroupMembership[]) {
  await AsyncStorage.setItem(MEMBERSHIPS_KEY, JSON.stringify(memberships));
}

/** Adds or replaces the membership for its group. */
export async function saveMembership(membership: GroupMembership): Promise<void> {
  const current = await readMemberships();
  await write([...current.filter((item) => item.groupId !== membership.groupId), membership]);
}

export async function renameMembership(groupId: string, name: string): Promise<void> {
  const current = await readMemberships();
  await write(current.map((item) => (item.groupId === groupId ? { ...item, name } : item)));
}

/** Forgets a group (left, removed or disbanded). */
export async function removeMembership(groupId: string): Promise<void> {
  const current = await readMemberships();
  await write(current.filter((item) => item.groupId !== groupId));
}

/** Forgets every group and the saved display name ("Reset & start over"). */
export async function clearMemberships(): Promise<void> {
  await AsyncStorage.multiRemove([MEMBERSHIPS_KEY, DISPLAY_NAME_KEY]);
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
