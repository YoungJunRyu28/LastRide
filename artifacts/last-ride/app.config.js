// Extends app.json with environment-specific native release settings.
const RELEASE_PROFILES = ["production", "preview", "galaxy"];
const STORE_RELEASE_PROFILES = ["production", "galaxy"];
const ANDROID_STORES = ["google-play", "galaxy"];

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

module.exports = ({ config }) => {
  // Select the billing provider at build time; never infer it from the handset.
  const androidStore = process.env.EXPO_PUBLIC_ANDROID_STORE?.trim() || "google-play";
  if (!ANDROID_STORES.includes(androidStore)) {
    throw new Error("EXPO_PUBLIC_ANDROID_STORE must be google-play or galaxy");
  }
  const profile = process.env.EAS_BUILD_PROFILE;
  if (profile === "production" && androidStore !== "google-play") {
    throw new Error("Google Play production builds must use google-play billing");
  }
  if (profile === "galaxy" && androidStore !== "galaxy") {
    throw new Error("Galaxy builds must use galaxy billing");
  }
  if (profile === "galaxy" && process.env.EAS_BUILD_PLATFORM === "ios") {
    throw new Error("Galaxy Store distribution only supports Android");
  }
  if (profile === "galaxy" && !/^galx_[A-Za-z0-9_\-]{3,}$/.test(process.env.EXPO_PUBLIC_REVENUECAT_GALAXY_KEY?.trim() || "")) {
    throw new Error("Galaxy releases require a Galaxy-specific EXPO_PUBLIC_REVENUECAT_GALAXY_KEY (galx_...)");
  }
  if (STORE_RELEASE_PROFILES.includes(profile) &&
      process.env.EXPO_PUBLIC_GALAXY_BILLING_MODE === "TEST") {
    throw new Error("Store releases cannot use Galaxy test billing");
  }

  const enableRemotePush = process.env.ENABLE_REMOTE_PUSH === "true";
  // Universal/App Links need the associated-domains entitlement, which free
  // (Personal Team) signing rejects, and the join domain must already serve
  // the files in docs/well-known/ — so they are opt-in.
  const enableUniversalLinks = process.env.ENABLE_UNIVERSAL_LINKS === "true";
  // The iOS Live Activity (leave-by countdown on the lock screen) and the
  // home/lock-screen widgets ship in a widget extension that needs an App
  // Group — also rejected by free signing.
  const enableLiveActivity = process.env.ENABLE_LIVE_ACTIVITY === "true";
  // The published iPhone experience includes the leave-time widget and Live Activity.
  // Do not silently ship a store binary with its native extension disabled.
  if (profile === "production" && process.env.EAS_BUILD_PLATFORM === "ios" && !enableLiveActivity) {
    throw new Error("Production iOS requires ENABLE_LIVE_ACTIVITY=true");
  }

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

  // Consumer groups use remote push and verified invite links in production.
  // Don't publish a silently crippled store binary when release flags are
  // missing. Internal preview/free-signing builds remain opt-in.
  if (STORE_RELEASE_PROFILES.includes(profile)) {
    if (!enableRemotePush)
      throw new Error('Production builds require ENABLE_REMOTE_PUSH=true');
    if (!enableUniversalLinks)
      throw new Error('Production builds require ENABLE_UNIVERSAL_LINKS=true');
  }


  const basePlugins = enableRemotePush
    ? (config.plugins || []).filter(
        (plugin) => plugin !== "./plugins/withoutPushEntitlement",
      )
    : config.plugins;
  // The same extension carries the premium home/lock-screen widget
  // (components/LeaveWidget.tsx); the Live Activity needs no entry here.
  const withLiveActivity = enableLiveActivity
    ? [
        ...basePlugins,
        [
          "expo-widgets",
          {
            widgets: [
              {
                name: "LeaveWidget",
                displayName: "帰り時",
                description: "今夜の出発時刻と残り時間",
                supportedFamilies: [
                  "systemSmall",
                  "systemMedium",
                  "accessoryRectangular",
                  "accessoryCircular",
                  "accessoryInline",
                ],
                contentMarginsDisabled: false,
                // Android home widgets need a Jetpack Compose layout; not yet.
                android: null,
              },
            ],
          },
        ],
      ]
    : basePlugins;
  // Uploads source maps so crash reports show real file/line numbers. Needs
  // SENTRY_ORG, SENTRY_PROJECT and (in the build environment) SENTRY_AUTH_TOKEN.
  const plugins =
    process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
      ? [
          ...withLiveActivity,
          [
            "@sentry/react-native/expo",
            {
              organization: process.env.SENTRY_ORG,
              project: process.env.SENTRY_PROJECT,
            },
          ],
        ]
      : withLiveActivity;

  const ios = {
    ...config.ios,
    infoPlist: {
      ...config.ios?.infoPlist,
      ...(enableLiveActivity ? { NSSupportsLiveActivities: true } : {}),
    },
    bundleIdentifier:
      process.env.IOS_BUNDLE_ID || config.ios.bundleIdentifier,
    // Signing team survives `expo prebuild --clean` (e.g. a Personal Team ID).
    ...(process.env.APPLE_TEAM_ID
      ? { appleTeamId: process.env.APPLE_TEAM_ID }
      : {}),
    ...(joinUrl ? { associatedDomains: ["applinks:" + joinUrl.hostname] } : {}),
    // Leave-now reminders and alarm stand-ins may break through Focus modes.
    entitlements: {
      ...((config.ios && config.ios.entitlements) || {}),
      "com.apple.developer.usernotifications.time-sensitive": true,
    },
  };

  // App Store bundle IDs are immutable for a published listing. An EAS
  // environment override is useful for Personal Team / preview development,
  // but changing it for a production iOS binary would break its provisioning,
  // subscription products, associated domains and widget app group.
  if (profile === "production" && process.env.EAS_BUILD_PLATFORM === "ios" &&
      ios.bundleIdentifier !== config.ios?.bundleIdentifier) {
    throw new Error(`Production iOS requires bundle ID ${config.ios?.bundleIdentifier}`);
  }

  // Inject a restricted native Android Maps SDK key at build time only.
  // Don't put this key in EXPO_PUBLIC_* or the JS bundle. Android-restricted
  // SDK keys are present in the native manifest by design; restrict them by
  // BOTH package name and Play/signing SHA-1 in Google Cloud Console.
  const androidMapsKeyEnvName = androidStore === "galaxy"
    ? "EXPO_ANDROID_GALAXY_GOOGLE_MAPS_API_KEY"
    : "EXPO_ANDROID_GOOGLE_MAPS_API_KEY";
  const androidMapsKey = (process.env[androidMapsKeyEnvName] || "").trim();
  if (androidMapsKey && !/^AIza[0-9A-Za-z_-]{35}$/.test(androidMapsKey)) {
    throw new Error(`${androidMapsKeyEnvName} is not a valid Google Maps Android SDK key`);
  }
  if (STORE_RELEASE_PROFILES.includes(profile) &&
      process.env.EAS_BUILD_PLATFORM !== "ios" && !androidMapsKey) {
    throw new Error(`Production builds require ${androidMapsKeyEnvName}`);
  }

  // A signed store release must not silently fall back to local test-premium
  // mode or send purchase receipts to a public SDK key for another store.
  // Never put RevenueCat sk_... secrets in any EXPO_PUBLIC_* variable.
  if (profile === "production" && process.env.EAS_BUILD_PLATFORM === "ios" &&
      !/^appl_[A-Za-z0-9_\-]{3,}$/.test(process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY?.trim() || "")) {
    throw new Error("Production iOS requires EXPO_PUBLIC_REVENUECAT_IOS_KEY (appl_...)");
  }
  if (profile === "production" && process.env.EAS_BUILD_PLATFORM !== "ios" &&
      !/^goog_[A-Za-z0-9_\-]{3,}$/.test(process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY?.trim() || "")) {
    throw new Error("Google Play production requires EXPO_PUBLIC_REVENUECAT_ANDROID_KEY (goog_...)");
  }

  const android = {
    ...config.android,
    ...(androidMapsKey ? { config: { ...(config.android?.config || {}), googleMaps: { apiKey: androidMapsKey } } } : {}),
    // Separate Galaxy identity prevents a Google Play app-signing certificate
    // from clashing with a separately signed Galaxy APK during updates.
    // Both apps still talk to the same backend and accept group invite links.
    package:
      process.env.ANDROID_PACKAGE_ID ||
      (androidStore === "galaxy" ? `${config.android?.package}.galaxy` : config.android?.package),
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
                {
                  scheme: "https",
                  host: joinUrl.hostname,
                  pathPrefix: "/group-join",
                },
              ],
              category: ["BROWSABLE", "DEFAULT"],
            },
          ],
        }
      : {}),
  };

  // Store package IDs are permanent once published. A stray EAS secret or
  // environment override must not silently produce a different application.
  const playPackage = config.android?.package;
  const galaxyPackage = `${playPackage}.galaxy`;
  if (profile === "production" && process.env.EAS_BUILD_PLATFORM !== "ios" &&
      android.package !== playPackage) {
    throw new Error(`Google Play releases require Android package ${playPackage}`);
  }
  if (profile === "galaxy" && android.package !== galaxyPackage) {
    throw new Error(`Galaxy releases require Android package ${galaxyPackage} (different from Google Play)`);
  }

  // The EAS project ID lives in app.json (set by `eas init`); EAS_PROJECT_ID
  // can override it, e.g. for a separate project.
  const easProjectId =
    process.env.EAS_PROJECT_ID || config.extra?.eas?.projectId || null;
  const extra = {
    ...(config.extra || {}),
    liveActivityEnabled: enableLiveActivity,
    androidGoogleMapsEnabled: Boolean(androidMapsKey),
    androidDistributionStore: androidStore,
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
  };

  // Over-the-air JS updates (expo-updates) need an EAS project to publish to.
  // Without one (local and free-signing builds) the app only ever runs the
  // JS bundled into the build. The fingerprint runtime version keeps an
  // update from reaching a build whose native code it wasn't made for.
  const updates = easProjectId
    ? {
        enabled: true,
        url: `https://u.expo.dev/${easProjectId}`,
        // Never hold up launch waiting for a download: check in the
        // background and apply the update on the next launch.
        checkAutomatically: "ON_LOAD",
        fallbackToCacheTimeout: 0,
      }
    : { enabled: false };

  return {
    ...config,
    ...(process.env.EAS_OWNER ? { owner: process.env.EAS_OWNER } : {}),
    plugins,
    ios,
    android,
    extra,
    updates,
    runtimeVersion: { policy: "fingerprint" },
  };
};
