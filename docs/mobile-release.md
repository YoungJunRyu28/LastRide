# Mobile release checklist

## Build identities

Default native application IDs:

- iOS: `com.nicholasroberts.lastride`
- Android: `com.nicholasroberts.lastride`

Local developers can override them with `IOS_BUNDLE_ID` and
`ANDROID_PACKAGE_ID`.

## Internal Android testing

The `preview` EAS profile produces an installable APK:

```bash
cd artifacts/last-ride
eas build --platform android --profile preview
```

This is the intended path for device testing before Play Store review.

## Store builds

```bash
cd artifacts/last-ride
eas build --platform ios --profile production
eas build --platform android --profile production
```

The Android production profile produces the default AAB suitable for Google
Play. The configured submit profile targets Google Play's internal testing
track first.

The `production` and `preview` profiles refuse to build unless
`EXPO_PUBLIC_API_URL` is an `https:` URL. Release builds never fall back to
sample train times; without a reachable API they report train times as
unavailable.

## Over-the-air updates

`expo-updates` lets a JS-only fix reach installed apps without store review.
It is active only in builds made with `EAS_PROJECT_ID` set; other builds
always run the JS they were built with.

- Each build profile has a channel (`preview`, `production`) in `eas.json`.
- `runtimeVersion` uses the `fingerprint` policy: any native change (new
  native module, SDK upgrade, config-plugin change) produces a new runtime,
  and an update only reaches builds with the same fingerprint. Native changes
  therefore always need a new store build.
- Installed apps check for an update in the background at launch and apply it
  on the next launch; startup is never blocked on a download.

`EXPO_PUBLIC_*` values are inlined when the update is bundled, exactly as in
a build, so publish with the same environment the build used. Keep those
values in the EAS project's environment variables (production/preview) and
pass `--environment`:

```bash
cd artifacts/last-ride
eas update --channel production --environment production --message "Fix ..."
```

Test on the `preview` channel first. To undo a bad update, republish the
previous one (`eas update:republish`) or roll back from the EAS dashboard.

## Crash reporting

Crash and error reports go to Sentry when the build sets
`EXPO_PUBLIC_SENTRY_DSN`; they are never sent from development builds or the
web. `lib/crashReporting.ts` removes query strings from request and navigation
URLs (coordinates, searches, join tokens) and drops console output, so
reports contain no location or destination data (see PRIVACY.md).

For readable stack traces, also set `SENTRY_ORG` and `SENTRY_PROJECT` for the
build and store `SENTRY_AUTH_TOKEN` as an EAS secret; the Sentry config
plugin then uploads source maps during EAS builds. In the Sentry project,
turn on data scrubbing and keep IP address storage off.

## Live Activity (iOS)

During night-out tracking, iOS can show the leave-by countdown on the lock
screen and in the Dynamic Island. Build with `ENABLE_LIVE_ACTIVITY=true` to
include it. This adds an `expo-widgets` extension and the App Group
`group.<bundle id>`; free (Personal Team) signing rejects App Groups, so it
is off by default. With a paid team, enable the App Group for both the app
and the `ExpoWidgetsTarget` extension (EAS credentials handle this).

The countdown is updated whenever the night is re-planned, foreground or
background, and ends when tracking stops or the last train has gone. iOS
marks it stale five minutes after the last train in case the app does not
wake again. The layout is `components/LeaveCountdownActivity.tsx`.

## Background location

LastRide uses background location only while night-out tracking is explicitly
enabled. The Expo location plugin configures the required native capabilities.

Before Google Play publication, complete the background-location declaration
and provide the review/demo material required by Play Console. Demonstrate:

1. the user explicitly enabling night-out tracking;
2. why location is required to keep the nearest station and leave-by time
   accurate while the app is backgrounded;
3. the visible benefit to the user;
4. how the user stops tracking.

## Remote organizer push

Production organizer push requires:

- a real EAS project;
- APNs/FCM credentials;
- `ENABLE_REMOTE_PUSH=true` for the native build.

Free/local iOS signing keeps remote push disabled and retains the existing
entitlement-stripping plugin.

## Business feature switch

LastRide for Business (joining groups, organizer events and organizer alerts)
is on by default. Build with `EXPO_PUBLIC_ENABLE_BUSINESS=false` to ship
without it: the Groups section disappears from Settings, the join, Business
and event screens redirect home (including `last-ride://join` links), and
organizer notifications are ignored. The API server is unaffected.

## Join links

The custom scheme `last-ride://join?token=...` works without a web domain.
Setting `EXPO_PUBLIC_APP_JOIN_BASE_URL` (an `https:` origin, e.g.
`https://join.example.com`) makes invites use `https://<join-domain>/join?token=...`
instead; the build fails if it is not HTTPS.

Opening those links in the app (iOS Universal Links / Android App Links) is a
separate opt-in, `ENABLE_UNIVERSAL_LINKS=true`, because it adds the iOS
associated-domains entitlement, which free (Personal Team) signing rejects.
Before enabling it, fill in the templates in `docs/well-known/` and serve them
from the join domain:

- `https://<join-domain>/.well-known/apple-app-site-association` — from
  `docs/well-known/apple-app-site-association` with your Apple Team ID and
  bundle ID. Serve it with `Content-Type: application/json`, over HTTPS, with
  no redirect.
- `https://<join-domain>/.well-known/assetlinks.json` — from
  `docs/well-known/assetlinks.json` with the Android package name and the
  SHA-256 fingerprint of the signing certificate (for Play App Signing, the
  one shown in Play Console, not the upload key).

Verify both URLs before building. On Android 12 and later, if `autoVerify`
verification fails, the system will not open the app for these links at all;
they open in the browser instead.

## Before store submission

- Confirm the privacy-policy repository contact is replaced with the production support/privacy channel if one is available.
- Use licensed production Ekispert credentials.
- Confirm the chosen replacement/contract for NAVITIME-backed routing.
- Apply production DB migrations.
- Verify organizer OTP login and push notifications on physical devices.
- Verify background tracking on both iOS and Android.
- Run the full test/typecheck suite.
