// Extends app.json. Free Apple ID signing ties a bundle ID to one person's team,
// so each developer can set their own in `.env.local`:
//   IOS_BUNDLE_ID=com.yourname.lastride
//
// Remote organizer push requires a paid/EAS-capable Apple signing profile.
// Local/free-signing builds keep the existing entitlement-stripping plugin.
module.exports = ({ config }) => {
  const enableRemotePush = process.env.ENABLE_REMOTE_PUSH === "true";
  const plugins = enableRemotePush
    ? (config.plugins || []).filter(
        (plugin) => plugin !== "./plugins/withoutPushEntitlement",
      )
    : config.plugins;

  return {
    ...config,
    plugins,
    ios: {
      ...config.ios,
      bundleIdentifier:
        process.env.IOS_BUNDLE_ID || config.ios.bundleIdentifier,
    },
    android: {
      ...config.android,
      package:
        process.env.ANDROID_PACKAGE_ID || config.android?.package,
    },
  };
};
