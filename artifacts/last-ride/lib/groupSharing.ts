/**
 * Which groups this phone is sharing tonight's leave time with, and the last
 * time it sent. The app keeps it current while open (GroupsContext); night
 * tracking reads it in the background, where the group details aren't loaded,
 * so friends' alerts use the current time even with LastRide closed.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { joinGroupTonight } from "@workspace/api-client-react";
import { readMemberships } from "@/lib/groupMemberships";

const SHARING_KEY = "lastride-group-sharing";

/** Smaller changes than this aren't worth a request (and a database wake-up). */
export const LEAVE_BY_RESEND_MS = 60_000;

type Sharing = Record<string, string | null>;

async function read(): Promise<Sharing> {
  try {
    const raw = await AsyncStorage.getItem(SHARING_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Sharing) : {};
  } catch {
    return {};
  }
}

async function write(sharing: Sharing) {
  await AsyncStorage.setItem(SHARING_KEY, JSON.stringify(sharing)).catch(() => undefined);
}

/** Notes that this phone shares with `groupId` tonight, with the time the server has. */
export async function markSharing(groupId: string, leaveBy: string | null): Promise<void> {
  const sharing = await read();
  if (groupId in sharing && sharing[groupId] === leaveBy) return;
  await write({ ...sharing, [groupId]: leaveBy });
}

export async function stopSharing(groupId: string): Promise<void> {
  const sharing = await read();
  if (!(groupId in sharing)) return;
  const { [groupId]: _removed, ...rest } = sharing;
  await write(rest);
}

export async function clearSharing(): Promise<void> {
  await AsyncStorage.removeItem(SHARING_KEY).catch(() => undefined);
}

/** Whether `next` differs enough from what the group last got to send it. */
export function leaveByChanged(previous: string | null | undefined, next: string): boolean {
  if (!previous) return true;
  return Math.abs(new Date(previous).getTime() - new Date(next).getTime()) >= LEAVE_BY_RESEND_MS;
}

/**
 * Sends tonight's leave time to every group this phone is sharing with, when
 * it changed by a minute or more. For background tracking; never throws.
 */
export async function syncSharedLeaveBy(leaveByMs: number): Promise<void> {
  const sharing = await read();
  const groupIds = Object.keys(sharing);
  if (groupIds.length === 0) return;
  const memberships = await readMemberships();
  const leaveBy = new Date(leaveByMs).toISOString();
  for (const groupId of groupIds) {
    if (!leaveByChanged(sharing[groupId], leaveBy)) continue;
    const membership = memberships.find((entry) => entry.groupId === groupId);
    if (!membership) {
      await stopSharing(groupId);
      continue;
    }
    try {
      await joinGroupTonight(groupId, { leaveBy }, { headers: { "X-Member-Token": membership.memberToken } });
      await markSharing(groupId, leaveBy);
    } catch (error) {
      // Gone, or the night ended: stop. Anything else (offline) retries next update.
      const status = (error as { status?: number } | null)?.status;
      if (status === 404 || status === 409) await stopSharing(groupId);
    }
  }
}
