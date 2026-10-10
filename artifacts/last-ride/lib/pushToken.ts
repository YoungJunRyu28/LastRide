/**
 * This device's Expo push token, for group notifications. Null when push
 * can't work here: web, no EAS project (local / free-signing builds), or
 * notifications not allowed. Never prompts — onboarding asks for permission.
 */
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

function projectId(): string | null {
  const eas = Constants.easConfig as { projectId?: string } | null;
  if (eas?.projectId) return eas.projectId;
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? null;
}

export async function expoPushToken(): Promise<string | null> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return null;
  const id = projectId();
  if (!id) return null;
  try {
    if (!(await Notifications.getPermissionsAsync()).granted) return null;
    return (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
  } catch {
    return null;
  }
}
