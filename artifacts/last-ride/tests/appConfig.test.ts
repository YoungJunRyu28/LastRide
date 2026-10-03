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
});
