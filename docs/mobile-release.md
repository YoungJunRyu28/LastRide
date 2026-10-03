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
Before using HTTPS join links publicly, configure the associated-domain/app-link
files for the domain in `EXPO_PUBLIC_APP_JOIN_BASE_URL`.

## Before store submission

- Confirm the privacy-policy repository contact is replaced with the production support/privacy channel if one is available.
- Use licensed production Ekispert credentials.
- Confirm the chosen replacement/contract for NAVITIME-backed routing.
- Apply production DB migrations.
- Verify organizer OTP login and push notifications on physical devices.
- Verify background tracking on both iOS and Android.
- Run the full test/typecheck suite.
