import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

type ExpoConfig = Record<string, any>;
const require = createRequire(import.meta.url);
const appConfig = require("../app.config.js") as (input: {
  config: ExpoConfig;
}) => ExpoConfig;
const baseConfig = (require("../app.json") as { expo: ExpoConfig }).expo;

function resolveWith(
  env: Record<string, string | undefined>,
  config: ExpoConfig = baseConfig,
): ExpoConfig {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return appConfig({ config });
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
        ENABLE_REMOTE_PUSH: "true",
        ENABLE_UNIVERSAL_LINKS: "true",
        EXPO_PUBLIC_APP_JOIN_BASE_URL: "https://lastride.jp",
      }),
    ).not.toThrow();
  });

  it("refuses a public binary without remote pushes or verified invite links", () => {
    expect(() => resolveWith({
      EAS_BUILD_PROFILE: "production",
      EXPO_PUBLIC_API_URL: "https://api.invalid.example",
      ENABLE_REMOTE_PUSH: undefined,
      ENABLE_UNIVERSAL_LINKS: "true",
      EXPO_PUBLIC_APP_JOIN_BASE_URL: "https://lastride.jp",
    })).toThrow("ENABLE_REMOTE_PUSH");
    expect(() => resolveWith({
      EAS_BUILD_PROFILE: "production",
      EXPO_PUBLIC_API_URL: "https://api.invalid.example",
      ENABLE_REMOTE_PUSH: "true",
      ENABLE_UNIVERSAL_LINKS: undefined,
    })).toThrow("ENABLE_UNIVERSAL_LINKS");
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
      { scheme: "https", host: "join.example", pathPrefix: "/group-join" },
    ]);
  });

  it("enables over-the-air updates only with an EAS project", () => {
    const { eas: _eas, ...extraWithoutProject } = baseConfig.extra ?? {};
    const local = resolveWith({ EAS_PROJECT_ID: undefined }, { ...baseConfig, extra: extraWithoutProject });
    expect(local.updates).toEqual({ enabled: false });
    expect(local.runtimeVersion).toEqual({ policy: "fingerprint" });

    // The project ID that `eas init` saved in app.json.
    const fromAppJson = resolveWith({ EAS_PROJECT_ID: undefined });
    expect(fromAppJson.updates).toMatchObject({
      enabled: true,
      url: "https://u.expo.dev/da307cab-09bc-43d3-a0dd-79c836c4ef97",
    });

    const override = resolveWith({ EAS_PROJECT_ID: "project-123" });
    expect(override.updates).toMatchObject({
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

  it("adds the widget extension (Live Activity + LeaveWidget) only when enabled", () => {
    const widgetsPlugin = (plugins: unknown[]) =>
      plugins.find(
        (plugin) => Array.isArray(plugin) && plugin[0] === "expo-widgets",
      ) as [string, { widgets: Array<{ name: string }> }] | undefined;

    const off = resolveWith({ ENABLE_LIVE_ACTIVITY: undefined });
    expect(widgetsPlugin(off.plugins)).toBeUndefined();
    expect(off.extra.liveActivityEnabled).toBe(false);

    const on = resolveWith({ ENABLE_LIVE_ACTIVITY: "true" });
    expect(widgetsPlugin(on.plugins)?.[1].widgets.map((widget) => widget.name)).toEqual(["LeaveWidget"]);
    expect(on.extra.liveActivityEnabled).toBe(true);
  });
});
