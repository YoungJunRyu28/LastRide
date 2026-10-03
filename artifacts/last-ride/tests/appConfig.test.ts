import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

type ExpoConfig = Record<string, any>;
const require = createRequire(import.meta.url);
const appConfig = require("../app.config.js") as (input: {
  config: ExpoConfig;
}) => ExpoConfig;
const baseConfig = (require("../app.json") as { expo: ExpoConfig }).expo;

function resolveWith(env: Record<string, string | undefined>): ExpoConfig {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return appConfig({ config: baseConfig });
}

describe("app.config.js", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(["production", "preview"])(
    "refuses a %s build without an HTTPS API URL",
    (profile) => {
      expect(() =>
        resolveWith({
          EAS_BUILD_PROFILE: profile,
          EXPO_PUBLIC_API_URL: undefined,
        }),
      ).toThrow("EXPO_PUBLIC_API_URL");
      expect(() =>
        resolveWith({
          EAS_BUILD_PROFILE: profile,
          EXPO_PUBLIC_API_URL: "http://api.example",
        }),
      ).toThrow("EXPO_PUBLIC_API_URL");
    },
  );

  it("accepts a release build with an HTTPS API URL", () => {
    expect(() =>
      resolveWith({
        EAS_BUILD_PROFILE: "production",
        EXPO_PUBLIC_API_URL: "https://api.invalid.example",
      }),
    ).not.toThrow();
  });

  it("does not require an API URL outside release profiles", () => {
    expect(() =>
      resolveWith({
        EAS_BUILD_PROFILE: undefined,
        EXPO_PUBLIC_API_URL: undefined,
      }),
    ).not.toThrow();
  });

  it("rejects a non-HTTPS join base URL", () => {
    expect(() =>
      resolveWith({ EXPO_PUBLIC_APP_JOIN_BASE_URL: "http://join.example" }),
    ).toThrow("EXPO_PUBLIC_APP_JOIN_BASE_URL");
  });

  it("adds link config only when universal links are enabled", () => {
    const withoutFlag = resolveWith({
      EXPO_PUBLIC_APP_JOIN_BASE_URL: "https://join.example:8443",
      ENABLE_UNIVERSAL_LINKS: undefined,
    });
    expect(withoutFlag.ios.associatedDomains).toBeUndefined();
    expect(withoutFlag.android.intentFilters).toBeUndefined();

    const withFlag = resolveWith({
      EXPO_PUBLIC_APP_JOIN_BASE_URL: "https://join.example:8443",
      ENABLE_UNIVERSAL_LINKS: "true",
    });
    expect(withFlag.ios.associatedDomains).toEqual(["applinks:join.example"]);
    expect(withFlag.android.intentFilters[0].data).toEqual([
      { scheme: "https", host: "join.example", pathPrefix: "/join" },
    ]);
  });

  it("enables over-the-air updates only with an EAS project", () => {
    const local = resolveWith({ EAS_PROJECT_ID: undefined });
    expect(local.updates).toEqual({ enabled: false });
    expect(local.runtimeVersion).toEqual({ policy: "fingerprint" });

    const eas = resolveWith({ EAS_PROJECT_ID: "project-123" });
    expect(eas.updates).toMatchObject({
      enabled: true,
      url: "https://u.expo.dev/project-123",
      fallbackToCacheTimeout: 0,
    });
  });

  it("adds Sentry source-map upload only when org and project are set", () => {
    const hasSentry = (config: ExpoConfig) =>
      config.plugins.some(
        (plugin: unknown) =>
          Array.isArray(plugin) && plugin[0] === "@sentry/react-native/expo",
      );
    expect(
      hasSentry(resolveWith({ SENTRY_ORG: undefined, SENTRY_PROJECT: undefined })),
    ).toBe(false);
    expect(
      hasSentry(resolveWith({ SENTRY_ORG: "org", SENTRY_PROJECT: "lastride" })),
    ).toBe(true);
  });

  it("keeps the signing team across prebuilds when APPLE_TEAM_ID is set", () => {
    expect(resolveWith({ APPLE_TEAM_ID: undefined }).ios.appleTeamId).toBeUndefined();
    expect(resolveWith({ APPLE_TEAM_ID: "ABCDE12345" }).ios.appleTeamId).toBe(
      "ABCDE12345",
    );
  });

  it("adds the Live Activity extension only when enabled", () => {
    const off = resolveWith({ ENABLE_LIVE_ACTIVITY: undefined });
    expect(off.plugins).not.toContain("expo-widgets");
    expect(off.extra.liveActivityEnabled).toBe(false);

    const on = resolveWith({ ENABLE_LIVE_ACTIVITY: "true" });
    expect(on.plugins).toContain("expo-widgets");
    expect(on.extra.liveActivityEnabled).toBe(true);
  });
});
