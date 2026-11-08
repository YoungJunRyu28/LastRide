# LastRide Google Play release audit — November 7, 2026

**Decision: engineering release candidate, NOT authorized for public rollout.** iOS is already published. The next Android step is a **Google Play internal test**, not a public production release, until the platform-specific release gates below are evidenced. This document is a snapshot of source/code checks, not a guarantee of real-device performance or Google approval.

## Android identity and parity

- Play package: `jp.lastride.app`; build profile: `production` (Play billing / RevenueCat `goog_...` SDK key); Android APK/AAB must target Android API 36+.
- Expo/React Native shares screens, API, station/timetable engine, group protocols, purchase entitlements, and locale with iOS. Android-native differences include Google Maps and platform geocoding, Android foreground-service notifications, home widgets, app links, FCM, Play Billing and no Apple AlarmKit / Dynamic Island.
- Separate Galaxy Store profile/package/channel is **not** the Play release. Never upload a Galaxy APK or Galaxy-billing build to Play.
- Android-only UI copy now describes Google Maps/Android Settings/Play subscriptions instead of claiming to use iPhone features. iOS branches are kept intact.
- Android background location requires a prominent, separately acknowledged in-app explanation before attempting the platform permission flow; users may opt for foreground-only. Review in a signed build and record demo video. A disclosure dialog alone is **not** Play approval.

## Verified locally

- Root TypeScript build passed after release-hardening changes.
- Mobile Vitest passed after release-hardening changes: 501 tests in 61 files.
- Android configuration/assetlinks/store-link tests passed after changes: 29 total.
- Expo Doctor passed 20/20 checks (dependency-version check explicitly skipped as in CI).
- Production-profile `expo prebuild --platform android --clean --no-install` passed after the patch **using synthetic local Firebase and maps keys only**. The generated manifest retained `ACCESS_BACKGROUND_LOCATION`, had `allowBackup=false`, blocked `SYSTEM_ALERT_WINDOW`/legacy storage, and included `autoVerify` links for both invite routes. These mock test keys are not deployable.
- Native `./gradlew :app:assembleRelease` succeeded on the baseline, local Gradle release project. `aapt dump badging` showed package `jp.lastride.app`, minSdk 24, targetSdk 36.
- Patched native `./gradlew :app:bundleRelease` succeeded locally with synthetic Firebase/Maps/RevenueCat values, outputting an **88 MB synthetic-only AAB**. The first attempt failed because Kotlin lint exceeded Android Gradle's default `MaxMetaspaceSize=512m`; retry with `-Xmx4096m -XX:MaxMetaspaceSize=1536m` succeeded with lint enabled. The Expo config plugin `plugins/withAndroidGradleMemory.js` now persists that JVM configuration across prebuilds.
- Caveats: neither the baseline APK nor the synthetic AAB is **EAS/Play signed with real credentials**; do not upload these verification artifacts. Build the real candidate after configuring authentic production credentials and physical-device testing.

## Dependency-advisory note

`pnpm audit --prod --audit-level=critical` exited successfully with **zero critical** advisories. The broader `pnpm audit --prod --json` still reported **19 findings: 8 high, 7 moderate and 4 low**. The eight high findings resolve through the transitive **Expo CLI/build toolchain**, including `node-forge`, `zod` and `decode-uri-component`; these are not evidence of exploitable behavior in the installed Android runtime, but should not be silently ignored. Review compatible Expo/toolchain upgrades and exposure separately before public rollout, with a locked dependency graph and repeat Android/iOS regression tests.

## Required external configuration (no fake keys, no premature public release)

1. **Play developer account:** verify the intended publisher's account and any required identity/address/payment profile. Register `jp.lastride.app` only under the account agreed by the founders. If an affected **personal** developer account was created after November 13, 2023, Play requires 12 opted-in testers continuously for 14 days before applying for production access.
2. **Firebase app registration & Expo push:** in Firebase create an **Android** app with exactly `jp.lastride.app`. Obtain its authentic `google-services.json`; configure as **file** variable `GOOGLE_SERVICES_JSON` in the EAS **production** environment. Do **not** commit the JSON. Register the Firebase FCM V1 service-account credential through Expo/EAS notifications credentials, not in `EXPO_PUBLIC_*`. This patch refuses production Android builds when the JSON is missing or its package mismatches. Test real group push from server → Expo → FCM → locked Android.
3. **EAS release variables:** production HTTPS `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_APP_JOIN_BASE_URL=https://lastride.jp`, `ENABLE_REMOTE_PUSH=true`, `ENABLE_UNIVERSAL_LINKS=true`, `EXPO_ANDROID_GOOGLE_MAPS_API_KEY` restricted to **Play app signing certificate SHA-1** + `jp.lastride.app`, `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=goog_...`, and Android app registration above. Keep all private server/payment credentials off-client.
4. **Play App Signing / Digital Asset Links:** choose or enroll the final Play signing key. From **Play Console → App integrity → App signing key certificate**, copy the **app signing SHA-256**, not the upload-key fingerprint. At repository root:
   ```bash
   ANDROID_PLAY_SIGNING_SHA256='REAL_PLAY_APP_SIGNING_SHA256' node scripts/generate-android-assetlinks.mjs
   ```
   Deploy the generated `site/.well-known/assetlinks.json` to `https://lastride.jp/.well-known/assetlinks.json` (HTTP 200, JSON, no redirect) through authorized site hosting. At audit time this URL returned **404**, so verified Android join links were blocked. Verify using a **Play-signed** test install: `adb shell pm verify-app-links --re-verify jp.lastride.app` and `adb shell pm get-app-links jp.lastride.app`. Test `/join` and `/group-join` with valid and expired invites.
5. **Billing:** create Play monthly/yearly subscriptions and base plans/offers with the intended trial, connect Play to the RevenueCat Android app, confirm `premium` entitlement, tax/payout products, purchase → restore → cancellation → expiry, and no accidental cross-platform premium migration. Test on a licensed Play tester account **from a Play-distributed build**, not a sideloaded debug build.
6. **Play policy & listing:** Play background-location permission declaration + video of the user-visible disclosure, opt-in and active night-tracking value; precise data-safety declarations for location, device identifiers, group/share metadata, and crash telemetry as actually transmitted; privacy policy, support contact, account/data deletion disclosures where applicable, app access instructions for reviewers, screenshots/video and Japanese/English copy. Do not advertise iOS Live Activities, Dynamic Island or iOS AlarmKit on the Android listing.
7. **Device/system QA:** signed Android 12–16+ phones (including Pixel and Samsung where possible), permissions denied/one-time/approximate/revoked, Doze/battery saver/process kill/reboot, background reminders and notification channels, maps and real street-level walking, current Japanese rail timetable samples including weekends/holidays/last and first trains, groups, reinstall and backup boundaries, push, widgets, Japanese/English small screens, accessibility, timezones and OTA rollback.
8. **Operational checks:** server migrations and fresh licensed timetable snapshot, real prod API health and logs, Sentry sensitive-data scrubbing, Android crash reporting, reliability and fallback limitations, two real devices for group tests, and documented rollback. A public release is blocked by the original `DEPLOYMENT-STOP-POINT.md` until evidence closes each P0 gate.

## Build / validation workflow

From repository root:
```bash
pnpm install --frozen-lockfile  # Node 24
node --test scripts/distribution-config.test.mjs scripts/generate-android-assetlinks.test.mjs
pnpm run typecheck
pnpm --filter @workspace/last-ride test
```

From `artifacts/last-ride` after approved **EAS production** environment and credentials:
```bash
eas build --platform android --profile production
# Verify the real AAB, signing identity, target SDK, size and manifest first.
eas submit --platform android --profile production --latest
# Submission profile explicitly targets internal testing, NOT production.
```
No credentials or real Play configuration were changed by this source audit, and neither EAS submission nor Google Play publication has been initiated. Proceed from internal → closed testing → reviewed production access/gradual rollout only after the required evidence exists.
