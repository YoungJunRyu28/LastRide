# LastRide partner-main integration — 2026-10-26

## Purpose

This **draft integration branch** combines partner's current `nicknr100/LastRide:main`
(commit `d54abfb`) with the existing PR #40 and PR #41 cross-platform release
hardening (through `3f9e228`). Neither parent PR has been merged to production.
Original stacked PRs remain unchanged for reference. No production deployment,
database migration, Apple signing, or store submission was performed.

## Partner changes intentionally retained

- Group sheet keyboard avoidance and editable/display name behavior.
- Paywall sheet sizing, TestFlight StoreKit storefront/price diagnostics, and
  monthly **¥190**, yearly **¥1,200** copy across the app and Japanese/English site.
  StoreKit remains the source of actual payable prices.
- Location onboarding's delayed iOS Always-permission decisions and automatic
  switch to background location when OS permission becomes available.
- Time Sensitive/Focus-aware reminders, 10-second iOS screen-off notification
  compensation (native AlarmKit remains exact), 1本前/2本前 train choices, partner's
  reminder no-churn scheduling and TestFlight notification testing.
- Widget Live Activity behavior, privacy and support page changes.

## Hardening features retained

- Authenticated, device-bound paid group hosting and RevenueCat identity/purchase
  restore handling; never replace with client-controlled subscriber IDs.
- Native AlarmKit scheduled-ID reconciliation, crash receipts, silent companion
  checks, and reminder cancellation limited to LastRide-owned identifiers.
  Stable unchanged native alarms are **not** cancelled on a routine re-plan.
- Walking-distance source metadata and added margin/warnings for unverified
  straight-line route estimates, including preserved source across nearby
  station and saved plan re-use. An unverified route is *not* guaranteed walkable.
- Backend group CAS revisions for out-of-order updates, durable mobile group
  outbox, two-hour minimal Expo push-receipt journal, six-phase deployment gates,
  release infrastructure validation and privacy safeguards from the draft stack.

## Six conflict resolutions

1. Group screen import includes both KeyboardAvoidingView and RefreshControl.
2. PremiumContext exposes partner's `known` / StoreKit `storeInfo` **and** secure
   group creation headers and migration/restore state.
3. Notifications: retain partner's stable per-event IDs, Time Sensitive behavior,
   TestFlight exception, 10-second offset and unchanged native alarms; retain
   native AlarmKit UUID/OS reconciliation and owned-notification receipts.
4. Reminder tests preserve both suites and confirm lost notification restoration
   is incremental (surviving alerts are not cancelled).
5. TrainChoice tests preserve both estimated-walk and slot-change regressions.
6. Website CSS includes both store-link placeholder styling and contact scroll offset.

## Verification

- Local workspace TypeScript: passed.
- Local mobile test suite: **354/354** passed.
- Local migration and generated API client verification: passed.
- Production JS export: iOS, Android, web passed.
- Alert schedule and privacy/budget gate tests: passed.
- Real Postgres-backed CI and native physical iPhone/APNs tests still required.

## Mandatory release gates

Do not deploy/merge to production merely because this integration PR passes CI.
Review changes to subscription identity on signed TestFlight sandbox devices,
privacy approval for receipt journal retention, migration-before-API rollout,
current licensed Japanese train snapshot/operator coverage and street-routing
accuracy, native AlarmKit and Focus behavior, Android/FCM two-device alert
behavior and production budget acknowledgement for 5-minute DB watchdog.
For merge readiness, partner should independently review the combined PR and
confirm pricing and UI changes reflect current product decisions.
