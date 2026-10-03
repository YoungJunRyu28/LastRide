// Extends app.json with environment-specific native release settings.
const RELEASE_PROFILES = ["production", "preview"];

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

module.exports = ({ config }) => {
  const enableRemotePush = process.env.ENABLE_REMOTE_PUSH === "true";
  // Universal/App Links need the associated-domains entitlement, which free
  // (Personal Team) signing rejects, and the join domain must already serve
  // the files in docs/well-known/ — so they are opt-in.
  const enableUniversalLinks = process.env.ENABLE_UNIVERSAL_LINKS === "true";

  // The app refuses to show sample train times in release builds, so a release
  // without a reachable HTTPS API would be useless; fail the build instead.
  const apiUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (
    RELEASE_PROFILES.includes(process.env.EAS_BUILD_PROFILE) &&
    !(apiUrl && isHttpsUrl(apiUrl))
  ) {
    throw new Error(
      `EXPO_PUBLIC_API_URL must be set to an HTTPS URL for the "${process.env.EAS_BUILD_PROFILE}" build profile.`,
    );
  }

  const joinBase = process.env.EXPO_PUBLIC_APP_JOIN_BASE_URL?.trim();
  if (joinBase && !isHttpsUrl(joinBase)) {
    throw new Error("EXPO_PUBLIC_APP_JOIN_BASE_URL must be a valid HTTPS URL.");
  }
  if (enableUniversalLinks && !joinBase) {
    throw new Error(
      "ENABLE_UNIVERSAL_LINKS=true requires EXPO_PUBLIC_APP_JOIN_BASE_URL.",
    );
  }
  const joinUrl = enableUniversalLinks ? new URL(joinBase) : null;

  const plugins = enableRemotePush
    ? (config.plugins || []).filter(
        (plugin) => plugin !== "./plugins/withoutPushEntitlement",
      )
    : config.plugins;

  const ios = {
    ...config.ios,
    bundleIdentifier:
      process.env.IOS_BUNDLE_ID || config.ios.bundleIdentifier,
    ...(joinUrl ? { associatedDomains: ["applinks:" + joinUrl.hostname] } : {}),
  };

  const android = {
    ...config.android,
    package:
      process.env.ANDROID_PACKAGE_ID || config.android?.package,
    ...(joinUrl
      ? {
          intentFilters: [
            ...((config.android && config.android.intentFilters) || []),
            {
              action: "VIEW",
              autoVerify: true,
              data: [
                {
                  scheme: "https",
                  host: joinUrl.hostname,
                  pathPrefix: "/join",
                },
              ],
              category: ["BROWSABLE", "DEFAULT"],
            },
          ],
        }
      : {}),
  };

  const extra = {
    ...(config.extra || {}),
    ...(process.env.EAS_PROJECT_ID
      ? { eas: { projectId: process.env.EAS_PROJECT_ID } }
      : {}),
  };

  return {
    ...config,
    ...(process.env.EAS_OWNER ? { owner: process.env.EAS_OWNER } : {}),
    plugins,
    ios,
    android,
    extra,
  };
};
