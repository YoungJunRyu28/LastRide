/**
 * Where the LastRide API server lives. Imported for its side effect by modules
 * that call the server, so both the app and the headless background task are
 * configured.
 */
import { setBaseUrl } from "@workspace/api-client-react";
import Constants from "expo-constants";
import { NativeModules, Platform } from "react-native";

const API_PORT = 8080;
export const isDevelopment =
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

/** The configured URL without trailing slashes, or null if it isn't usable in this build. */
function validatedConfiguredUrl(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (!isDevelopment && parsed.protocol !== "https:") return null;
  return trimmed;
}

/**
 * Release builds are refused at build time (app.config.js) without an HTTPS
 * EXPO_PUBLIC_API_URL. Never throw here: this runs at module load, so a throw
 * would crash the app at launch. Without a server, production lookups report
 * "unavailable" rather than showing sample times (see lib/timetable.ts).
 */
function resolveApiBaseUrl(): string | null {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured?.trim()) {
    const url = validatedConfiguredUrl(configured);
    if (!url) {
      console.error(
        isDevelopment
          ? "[LastRide] EXPO_PUBLIC_API_URL must be an absolute URL."
          : "[LastRide] EXPO_PUBLIC_API_URL must be an absolute HTTPS URL; train times are unavailable.",
      );
    }
    return url;
  }

  if (!isDevelopment) {
    console.error(
      "[LastRide] EXPO_PUBLIC_API_URL is not set; train times are unavailable.",
    );
    return null;
  }

  const host = devMachineHost();
  return host ? `http://${host}:${API_PORT}` : null;
}

export const apiBaseUrl = resolveApiBaseUrl();

/**
 * Public community OSM/Photon endpoints are useful during local development,
 * but production traffic must stay on contracted/provider-backed services.
 * An explicit build-time opt-in exists only for controlled testing.
 */
export const communityFallbacksEnabled =
  isDevelopment ||
  process.env.EXPO_PUBLIC_ENABLE_COMMUNITY_FALLBACKS === "true";

setBaseUrl(apiBaseUrl);

if (isDevelopment) {
  console.log(
    `[LastRide] API server: ${apiBaseUrl ?? "none — using sample train times"}`,
  );
}
