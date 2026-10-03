/**
 * Where the LastRide API server lives. Imported for its side effect by modules
 * that call the server, so both the app and the headless background task are
 * configured.
 */
import { setBaseUrl } from "@workspace/api-client-react";
import Constants from "expo-constants";
import { NativeModules, Platform } from "react-native";

const API_PORT = 8080;
const isDevelopment =
  typeof __DEV__ !== "undefined"
    ? __DEV__
    : process.env.NODE_ENV !== "production";

/** Host of the machine running Metro — the API server runs next to it in development. */
function devMachineHost(): string | null {
  if (Platform.OS === "web") {
    return typeof window !== "undefined" ? window.location.hostname : null;
  }
  const sourceCode = NativeModules.SourceCode as
    | {
        scriptURL?: string;
        getConstants?: () => { scriptURL?: string };
      }
    | undefined;
  const scriptURL =
    sourceCode?.getConstants?.().scriptURL ?? sourceCode?.scriptURL;
  const fromBundle = scriptURL?.match(/^https?:\/\/([^/:]+)/)?.[1];
  return fromBundle ?? Constants.expoConfig?.hostUri?.split(":")[0] ?? null;
}

function validatedConfiguredUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("EXPO_PUBLIC_API_URL must be an absolute URL.");
  }
  if (!isDevelopment && parsed.protocol !== "https:") {
    throw new Error("Production LastRide builds require an HTTPS API URL.");
  }
  return trimmed;
}

function resolveApiBaseUrl(): string | null {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured?.trim()) return validatedConfiguredUrl(configured);

  if (!isDevelopment) {
    throw new Error(
      "EXPO_PUBLIC_API_URL is required in production; refusing to use sample timetable data.",
    );
  }

  const host = devMachineHost();
  return host ? `http://${host}:${API_PORT}` : null;
}

export const apiBaseUrl = resolveApiBaseUrl();
setBaseUrl(apiBaseUrl);

if (isDevelopment) {
  console.log(
    `[LastRide] API server: ${apiBaseUrl ?? "none — using sample train times"}`,
  );
}
