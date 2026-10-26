# October 26, 2026 — partner changes + release-hardening integration

## Scope

This review branch reconciles the October 26 `main` changes with the existing
cross-platform hardening stack (PR #40 and the draft Galaxy/iOS work in PR #41).
The integration deliberately does **not** deploy, run live migrations, change
store products, or merge the still-unapproved release code into production.

## Resolved overlaps

- Group sheet retains `KeyboardAvoidingView` and pull-to-refresh (`RefreshControl`).
- Premium provider retains server-bound RevenueCat device-secret headers,
  paid-subscriber restore/migration safeguards, a **known** entitlement state
  for Live Activities, and TestFlight storefront/currency inspection. Storefront
  requests now wait for RevenueCat identity setup.
- Reminders retain iOS calendar triggers, 10-second screen-off anticipation,
  exact Apple AlarmKit sound, Time Sensitive/Focus handling, stable reminder IDs,
  and uninterrupted TestFlight notifications. Re-plans keep unchanged queued
  notifications and native alarms **only if native alarm receipts and the OS
  scheduled IDs agree**. Missing native alarms or receipts trigger repair; app
  reminder cancellation is scoped to LastRide identifiers.
- Selected earlier trains keep the provenance of an unverified pedestrian walk;
  cached same-location walking routes preserve `routed` vs `estimated` rather
  than accidentally removing the extra precautionary walking allowance.
- Preserves the partner's ¥190 monthly / ¥1,200 annual UI and website copy,
  onboarding changes, group keyboard changes, widget paywall behavior and
  diagnostic improvements. Store amounts still need independent review of the
  actual configured App Store / Play / Galaxy products.

## Verified in isolated working tree

- `pnpm typecheck`: PASS.
- Mobile Vitest: **354/354 PASS** (including native AlarmKit loss and
  unchanged reminder retention, purchase identity, and train-choice tests).
- Release-script checks: **51/51 PASS**.
- `pnpm verify:codegen`: PASS.
- `pnpm verify:migrations`: PASS.
- iOS/Android/web Expo JS production bundle export: PASS.
- API-server tests locally: blocked by missing `DATABASE_URL`/running Postgres;
  these **must** pass with a real disposable Postgres in CI before merging.
- Local tests initially ran under Node 26 (workspace engine requires Node 24);
  final CI must verify the supported Node 24 runtime.

## Non-negotiable remaining release gates

1. Run automated CI, review DB migrations 0012–0016 in chronological order,
   test staging migration and backward compatibility, and set up rollback.
2. Obtain lawful, complete and fresh Japanese railway last-train coverage,
   street-level walking route validation and a measured catch-rate corpus.
   The estimated-walk buffer is not a route guarantee.
3. Verify RevenueCat plans/prices, anonymous-subscriber identity migration,
   restored purchases, App Store sandbox and legacy-client compatibility with
   **signed physical devices**. Never release on simulated entitlements.
4. Verify signed iOS APNs/AlarmKit delivery with screen locked/Focus/Low Power,
   background navigation, Live Activities and widgets on real iPhones.
5. Verify Android Play and Samsung physical-device Maps/FCM/Doze, store billing,
   app links/signing and cross-platform group workflows. Configure production
   credentials outside Git and validate real listing URLs.
6. Review server alert recovery, privacy/receipt retention and production
   monitoring. Don't bypass the fail-closed rollout attestations.

**Review only**: no production DB migration, AWS deploy, App Store/Play/Galaxy
submission or automatic merge is authorized by this integration.
