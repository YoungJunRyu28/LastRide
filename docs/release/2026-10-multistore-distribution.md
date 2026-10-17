# LastRide multi-store expansion — implementation and release gates (2026-10-17)

**Status: development-ready, not approved for distribution.** This work is based on draft
cross-platform hardening PR #40; it does not eliminate that PR's P0 Japanese last-train,
walking-route, push delivery, database migration, identity/recovery, or Play background-location gates.
Do not release either store binary or migrate production as part of this work.

## Implemented

- One Expo/React Native project and one backend remain shared across iOS and Android.
- Google Play uses `EXPO_PUBLIC_ANDROID_STORE=google-play`, package `jp.lastride.app`,
  and `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` (existing Play purchases).
- Galaxy Store uses `EXPO_PUBLIC_ANDROID_STORE=galaxy`, package
  `jp.lastride.app.galaxy`, `EXPO_PUBLIC_REVENUECAT_GALAXY_KEY`, and the
  `react-native-purchases-store-galaxy` native addon. The `galaxy` EAS build
  profile produces a store-ready APK, not a Google Play AAB.
- The distinct Galaxy package avoids cross-store update/signing collisions when
  Google Play holds an unavailable Google-generated app-signing key. Galaxy and
  Play installs are **two Android applications**, sharing the backend and group
  protocol; premium purchases remain tied to their respective store until a
  verified user-account and purchase-portability design exists.
- Release configuration refuses missing HTTPS API, remote push, universal links,
  Android Maps key, or Galaxy RevenueCat key. A store build cannot use Galaxy TEST billing.
- `/join/` and `/group-join/`, plus the homepage, offer iOS/Android download links
  only for **verified public URLs** filled into `site/store-listings.js`.
  Android links are prioritized on Android; iOS links on iPhone. Invite tokens
  are never forwarded to a store URL. Unreleased listings have no clickable
  placeholder link.
- `scripts/generate-android-assetlinks.mjs` can output *two* Android
  package/certificate associations when both real SHA-256 fingerprints are supplied.

## Release ownership and key handling

1. Verify **who controls** each Apple, Play, Galaxy, RevenueCat, EAS, domain,
   backend and signing account before creating public commercial listings.
   Store accounts, bank payouts, legal publisher name and app IP ownership are
   separate matters; source-code permissions do not grant company ownership.
2. Complete existing Play developer verification and register `jp.lastride.app`
   only after verifying its intended permanent identity and legal publisher.
   Google Play's **app signing certificate** and upload certificate are different.
3. Create a Galaxy Store Seller Portal account, obtain Commercial Seller status,
   and register package `jp.lastride.app.galaxy` (no need to use Play's signature).
   Give each founder only the roles needed; do not share personal login passwords.
4. In RevenueCat, add a **Galaxy Store** app to the existing project with the
   Galaxy package ID and Samsung Seller Portal service-account credentials.
   Create matching Galaxy monthly/annual products and entitlement mapping.
   Store the **private** Samsung service-account key *only* in RevenueCat's
   credential settings, not in a repository, public environment variable, or log.
5. Configure `EXPO_PUBLIC_REVENUECAT_GALAXY_KEY` in EAS production environment
   (this is a *public SDK key*, not the Samsung service-account secret).
   Confirm `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` remains the Play public SDK key.
6. Configure Android Google Maps SDK keys **per package and signing cert SHA-1**.
   The Galaxy build explicitly uses `EXPO_ANDROID_GALAXY_GOOGLE_MAPS_API_KEY`,
   separate from Play's `EXPO_ANDROID_GOOGLE_MAPS_API_KEY`. Validate the
   actual rendered maps on a Samsung device; a debug build is not proof.
7. Create separate signing credentials for the Galaxy APK and **back them up**
   securely. Never commit signing keys to GitHub. For the same-package strategy
   in future, both stores must use identical signing certs; this branch intentionally
   avoids that fragile requirement via distinct package IDs.

## Verified app links before users receive invites

- Read Play **app signing certificate SHA-256** from Play Console's App integrity,
  and Galaxy distribution **signing certificate SHA-256** from the final APK/keystore
  (not from a debug key or an unverified human transcription).
- Run from the repo root:

```sh
ANDROID_PLAY_SIGNING_SHA256='REAL_PLAY_APP_SIGNING_SHA256' \
ANDROID_GALAXY_SIGNING_SHA256='REAL_GALAXY_APK_SIGNING_SHA256' \
node scripts/generate-android-assetlinks.mjs
```

- This writes `site/.well-known/assetlinks.json` for both
  `jp.lastride.app` and `jp.lastride.app.galaxy`; **don't run with placeholders**.
- Deploy the static site to `https://lastride.jp` through the authorized
  hosting process. Verify HTTPS 200 JSON, without redirects, at
  `/.well-known/assetlinks.json` and
  `/.well-known/apple-app-site-association`.
- Verify Android App Links using both **release-signed** APKs on actual devices,
  including `/join?token=...`, `/group-join?invite=...`, no-app fallback,
  browser behavior, existing install, and expired/rotated invites.
- Only after each store listing is truly public, fill in that exact trusted
  store URL (Google Play: `https://play.google.com/store/apps/details?id=jp.lastride.app`) in `site/store-listings.js`, deploy the site, and retest invitation
  links. Do not substitute a guessed listing URL.

## Build and testing

```sh
# Run in the workspace root:
pnpm install --frozen-lockfile
node --test scripts/distribution-config.test.mjs scripts/store-downloads.test.mjs \
  scripts/generate-android-assetlinks.test.mjs
pnpm run typecheck
pnpm test

# From artifacts/last-ride after EAS credentials / env setup:
eas build --platform android --profile production  # Google Play AAB
eas build --platform android --profile galaxy      # separate Galaxy APK
eas build --platform ios --profile production
```

EAS production variables must include HTTPS `EXPO_PUBLIC_API_URL`,
`EXPO_PUBLIC_APP_JOIN_BASE_URL`, `ENABLE_REMOTE_PUSH=true`,
`ENABLE_UNIVERSAL_LINKS=true`, `EXPO_ANDROID_GOOGLE_MAPS_API_KEY`,
and each store's RevenueCat public key. Use
`EXPO_ANDROID_GALAXY_GOOGLE_MAPS_API_KEY` on the Galaxy build. Validate Galaxy IAP with a **physical
Galaxy handset** logged in to a Samsung account, including purchase, trial,
cancel, restore, and server entitlement verification.

Before any rollout: a Google Play internal testing review, Galaxy Store closed
beta, and iOS TestFlight; 2-device cross-platform group tests (join/rejoin,
notifications, ownership recovery, push token rotation), app links and installs,
offline/timezone/transit checks, background location disclosures and consent,
accessibility, database migration-before-code rehearsal, telemetry/rollback.

## Phase 2 — safe multi-store links and OTA segregation

- **Critical OTA fix:** EAS Galaxy release channel is now `galaxy`, not `production`. The
  original shared project remains, but Galaxy native billing JS updates cannot be
  accidentally delivered through Google Play's production update channel. Do
  not change this back without a full cross-store update-compatibility review.
- The same bilingual smart-download component understands Uptodown and Huawei
  AppGallery **only after an actual public LastRide listing is entered** in
  `site/store-listings.js`. Uptodown accepts an exact LastRide subdomain listing
  `https://lastride.en.uptodown.com/android` and Huawei accepts an `app/C...`
  listing, both under strict HTTPS/host/path validation. These illustrate the
  accepted URL formats, **not confirmed current LastRide listings**. Blank
  strings remain shipped so neither store is promoted prematurely. No invite
  token or unrelated query string is forwarded.
- **Uptodown requires a directly uploaded APK**, not an AAB or a Google Play
  details URL. Before enabling its link, create an explicitly supported billing
  strategy, sign the exact release APK, and validate updates and purchases.
  Do not reuse Galaxy IAP or Play-only IAP under a different distribution by
  changing only the store URL. Uptodown is currently **distribution research /
  website-ready, not binary-ready**.
- **AppGallery is not binary-ready.** Devices without Google Mobile Services
  may not display the Google Maps SDK correctly; Huawei Maps, native geocoding,
  push transport, purchases and notification lifecycle need a separate audited
  variant and real devices. A store link alone does not make it compatible.
- **GetApps, OPPO, vivo and HONOR** remain candidate integrations; do not
  invent app detail URLs or add hidden billing assumptions. Xiaomi's own
  GetApps developer guidance says Google Play IAP apps need GetApps IAP
  integration/verification. The release priority remains Play + iOS, then
  Samsung, then vetted Uptodown/Huawei/Xiaomi/other regionally useful stores.

## Later markets and distributors

- **Uptodown / direct APK**: only use a deliberately compatible and correctly
  signed billing/distribution variant. Never relabel a Google Play billing
  binary as a Galaxy IAP build or upload an AAB as an APK.
- **Huawei AppGallery / Xiaomi GetApps / OPPO / vivo**: each requires separate
  checks for store policies, billing, Google Mobile Services availability,
  geocoder/maps/push compatibility, privacy declarations and device coverage.
  These are follow-on integrations, not automatic publishing targets.
- **Web**: the site routes users to published iOS/Android listings; it does
  not currently replace the native app's notifications, navigation or payments.

## Remaining critical blockers (NOT completed here)

1. Actual Play developer verification, listing approval, release signing certificates,
   Galaxy Seller Portal / RevenueCat service account and Galaxy purchase products.
2. Real production backend, real train data and street-level walking-route parity.
3. Physical iOS/Android/Samsung QA, push/APNs/FCM, app links, IAP cross-store identity,
   migrations and production rollback practice.
4. Apple/Google/Samsung declarations, publisher identity, tax and payout setup,
   confirmed store metadata/branding ownership.

## Fail-closed billing keys for production

The Play release now requires a `goog_...` RevenueCat **public SDK key**, the iOS
App Store release requires `appl_...`, and Galaxy requires `galx_...`. The key
must match the correct RevenueCat app for that store/package. An empty key,
Test Store key or `sk_...` server secret fails release configuration; otherwise
the app could silently enable the development premium switch and fail live
purchases. Validation checks key class, **not actual server-side entitlement**.
Keep RevenueCat server secrets solely in the API backend secret store.

### Release package immutability

The two Android store profiles now reject `ANDROID_PACKAGE_ID` overrides that
would silently change the Google Play `jp.lastride.app` or Galaxy
`jp.lastride.app.galaxy` package. Development builds may still use another
package for isolated testing. This is important because Google Play's app
signing certificate, Galaxy's APK signing identity, Android verified links,
Maps API key restrictions and each store's subscription catalogue are tied
to the exact package. To intentionally rename a production app, create and
review a dedicated migration/listing plan rather than bypassing the guard.

## Phase 3 — iOS + Android reliability brushups (2026-10-17)

### Reminder scheduling: recover from OS-cleared notifications

The mobile scheduler previously trusted a persisted JSON signature even when
iOS/Android no longer had a corresponding pending local notification (e.g., OS
removed a reminder, pending requests were cleared or a headless process died).
It now records **future native notification IDs and fire times** and, when a
replan has the same signature, compares them with the OS pending queue before
skipping. Missing entries trigger a rebuild. OS native identifiers are prefixed
`lastride-local-` and group/boarding questions retain `lastride-boarded-`,
so a crashed background-task window can be cleaned on the next schedule
without deleting unrelated notifications from the app. Immediate notices
are intentionally not counted as future pending reminders. A failed OS queue
query does not cause repeated alarm storms; a later check retries.

**Limit:** This improves recovery **when a new replan occurs**. It does not
force iOS to wake a suspended app, bypass Focus/Doze, guarantee a foreground
notification if permissions are denied, or reconstruct alerts at the exact
instant the OS clears them. Validate with device-level sleep/background tests.

### iOS MapKit vs Android map parity

Both platforms now refuse to draw fictitious straight-line pedestrian routes
when only endpoints or estimated walking time are available. A supplied real
route polyline must have *every* coordinate finite and in the safe map range;
one corrupt vertex invalidates the polyline rather than joining across an
unknown gap. Long paths are downsampled with both endpoints retained.
The iOS MapKit card won't retain an old location's map snapshot underneath
new place markers while the next snapshot loads. Both platforms label map
fallbacks when no real tile view is available. iOS-native MapKit validates
origin/destination/radius/time before constructing native search/directions
requests and rejects PNG encoding failure instead of handing JS a nonexistent
file URI. MapKit search results are also filtered in JS to reject invalid
coordinates before distance sorting. **Map rendering does not solve missing
railway data, verified street-level walking geometry or provider coverage.**

### Physical QA still needed before distributing

- iPhone 15/16/17 and current OS where available, iOS older than 26 and
  iOS 26+ AlarmKit: grant/deny/revoke time-sensitive notification access;
  allow/deny background location and disable Precise Location; reschedule a
  15-minute/leave-now reminder on an unchanged plan, re-plan after system
  pending-alert cancellation and after background process termination.
- TestFlight launch after an OTA rollback; change stations while previous
  MapKit snapshot is loading; verify no wrong map image/route is displayed;
  try data gaps, missing provider routes and bad coordinates.
- Google Play Android and Galaxy Android: verify native map tiles, location
  search, Doze/background notification behavior, battery restriction and OS
  permission changes; verify no imaginary route crosses an obstacle.
- Galaxy purchase/restore/trial/expiry and Play purchase/restore must be
  tested with actual store accounts and correctly restricted signing keys.
- The connected Mac currently has Xcode installed but Apple's Xcode license
  has **not been accepted**. `swift-frontend -parse` passed; full iOS native
  compile and simulator/device signing tests are **blocked until the owner
  reviews and accepts the Xcode license**. Do not represent the Swift parse
  check as an iOS app build.
