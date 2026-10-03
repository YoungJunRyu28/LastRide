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
