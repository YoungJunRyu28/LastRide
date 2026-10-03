// Extends app.json with environment-specific native release settings.
module.exports = ({ config }) => {
  const enableRemotePush = process.env.ENABLE_REMOTE_PUSH === "true";
  const joinBase = process.env.EXPO_PUBLIC_APP_JOIN_BASE_URL?.trim();
  let joinHost = null;
  if (joinBase) {
    try {
      const url = new URL(joinBase);
      if (url.protocol === "https:") joinHost = url.host;
    } catch {
      throw new Error("EXPO_PUBLIC_APP_JOIN_BASE_URL must be a valid HTTPS URL.");
    }
  }

  const plugins = enableRemotePush
    ? (config.plugins || []).filter(
        (plugin) => plugin !== "./plugins/withoutPushEntitlement",
      )
    : config.plugins;

  const ios = {
    ...config.ios,
    bundleIdentifier:
      process.env.IOS_BUNDLE_ID || config.ios.bundleIdentifier,
    ...(joinHost ? { associatedDomains: ["applinks:" + joinHost] } : {}),
  };

  const android = {
    ...config.android,
    package:
      process.env.ANDROID_PACKAGE_ID || config.android?.package,
    ...(joinHost
      ? {
          intentFilters: [
            ...((config.android && config.android.intentFilters) || []),
            {
              action: "VIEW",
              autoVerify: true,
              data: [{ scheme: "https", host: joinHost, pathPrefix: "/join" }],
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
