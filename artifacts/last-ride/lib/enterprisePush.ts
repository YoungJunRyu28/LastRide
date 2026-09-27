import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import {
  registerEnterpriseHostDevice,
  unregisterEnterpriseHostDevice,
} from "@workspace/api-client-react";
import { enterpriseRequestOptions } from "@/lib/enterpriseHostAuth";

const HOST_PUSH_TOKEN_KEY = "lastride-enterprise-host-push-token";

function projectId(): string | null {
  const eas = Constants.easConfig as { projectId?: string } | null;
  if (eas?.projectId) return eas.projectId;
  const extra = Constants.expoConfig?.extra as
    { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? null;
}

export async function registerEnterprisePushDevice(): Promise<boolean> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return false;
  const id = projectId();
  if (!id) return false;

  const existing = await Notifications.getPermissionsAsync();
  const permission = existing.granted
    ? existing
    : await Notifications.requestPermissionsAsync();
  if (!permission.granted) return false;

  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: id }))
      .data;
    const options = await enterpriseRequestOptions();
    await registerEnterpriseHostDevice(
      { expoPushToken: token, platform: Platform.OS },
      options,
    );
    await AsyncStorage.setItem(HOST_PUSH_TOKEN_KEY, token);
    return true;
  } catch {
    return false;
  }
}

export async function unregisterEnterprisePushDevice(): Promise<void> {
  const token = await AsyncStorage.getItem(HOST_PUSH_TOKEN_KEY).catch(
    () => null,
  );
  if (!token || (Platform.OS !== "ios" && Platform.OS !== "android")) return;

  try {
    const options = await enterpriseRequestOptions();
    await unregisterEnterpriseHostDevice(
      { expoPushToken: token, platform: Platform.OS },
      options,
    );
  } finally {
    await AsyncStorage.removeItem(HOST_PUSH_TOKEN_KEY).catch(() => undefined);
  }
}
