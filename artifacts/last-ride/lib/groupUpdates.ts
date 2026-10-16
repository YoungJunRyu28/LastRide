/**
 * Live group updates without polling: the server sends a silent push
 * ("group_updated") to the other members whenever something they see changes,
 * and an open app refreshes that group at once. Closed apps don't need it:
 * they refresh when opened.
 *
 * Silent pushes reach the app through a background notification task (iOS:
 * the `remote-notification` background mode), defined at module scope so the
 * OS can call it. Visible group pushes (今夜の開始, leave times) also refresh
 * when they arrive while the app is open.
 */
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

export const GROUP_UPDATE_TASK = "lastride-group-updated";

type Listener = (groupId: string | null) => void;
const listeners = new Set<Listener>();

/** Calls `listener` with the changed group's id (null: refresh them all). */
export function onGroupUpdated(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The groupId in a push payload, wherever the platform nests it (or null). */
export function findGroupId(payload: unknown, depth = 0): string | null {
  if (!payload || depth > 5) return null;
  if (typeof payload === "string") {
    // Expo delivers custom data as a JSON string on some paths.
    if (!payload.includes("groupId")) return null;
    try {
      return findGroupId(JSON.parse(payload), depth + 1);
    } catch {
      return null;
    }
  }
  if (typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.groupId === "string") return record.groupId;
  for (const value of Object.values(record)) {
    const found = findGroupId(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function announce(payload: unknown) {
  const groupId = findGroupId(payload);
  for (const listener of listeners) listener(groupId);
}

if (Platform.OS !== "web") {
  TaskManager.defineTask(GROUP_UPDATE_TASK, async ({ data, error }) => {
    if (error || !data) return;
    announce(data);
  });
}

let registered = false;

/**
 * Starts listening: the silent-push task plus visible group pushes that arrive
 * while the app is open. Safe to call more than once.
 */
export function startGroupUpdates(): () => void {
  if (Platform.OS === "web") return () => undefined;
  if (!registered) {
    registered = true;
    // Needs the remote-notification background mode (a native build).
    void Notifications.registerTaskAsync(GROUP_UPDATE_TASK).catch(() => {
      registered = false;
    });
  }
  const subscription = Notifications.addNotificationReceivedListener((notification) => {
    const data = notification.request.content.data as Record<string, unknown> | undefined;
    if (data?.groupId) announce(data);
  });
  return () => subscription.remove();
}
