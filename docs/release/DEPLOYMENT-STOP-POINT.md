# LastRide deployment stopping point — evidence-driven decision

Reviewed 2026-10-27. **Decision: NOT READY FOR PUBLIC DEPLOYMENT.**
Green unit tests, a JavaScript bundle and a mergeable PR are not sufficient.
Every release gate requires verifiable evidence from the actual signed build.
Do not self-approve gates based on source review alone.

## Stage 1 — controlled, signed closed beta

A limited invited beta is a reasonable stopping point ONLY when:

1. **Departure truthfulness:** a real, current, licensed timetable dataset is
   deployed in staging and tested with actual Japanese route/operator data.
   Verify weekends, holidays, overnight journeys, missed trains and transfers.
   Unsupported routes must be labelled unavailable or estimated, never exact.
2. **Safe walking estimates:** barrier/crossing/entrance routes are tested on
   real maps and representative actual journeys. Dangerous reproducible
   departure recommendations block even beta release.
3. **Actual alerts:** signed iPhone and Android tests cover active, locked,
   background, reboot, revoked permissions, Focus and Doze conditions.
   Document OS delivery limitations and failure recovery.
4. **Security/privacy:** test secure group token migration, interrupted group
   operations, Android backup/Keystore loss, and group cleanup on two devices.
5. **Release hygiene:** full CI, API migrations, API generation, signed app
   builds, distribution fingerprints, HTTPS links and environment checks
   pass on the exact candidate. Rehearse rollback and assign monitoring owner.
6. **Scope-limited purchase testing:** verify subscription/restore in approved
   sandbox flows or disable unverified premium functionality for beta.

Start with invited testers who understand the feature coverage and can report
incorrect train advice. A closed beta is not authorization for a public launch.

## Stage 2 — public store deployment

All Stage 1 criteria, PLUS:

- Demonstrated iOS/Android train and walking parity in supported markets,
  or accurate, conspicuous platform-specific coverage limitations.
- Correct Apple/Google/Galaxy listings, policies and background-location
  disclosures, signed Universal Links and Android Digital Asset Links.
- RevenueCat server authorization, purchase restoration, cancellation, expiry,
  reinstall, identity migration and cross-platform upgrade cases validated.
- Real two-device and large-group scenarios, push delivery receipts, monitoring,
  operational retention and rollback drill proven.
- Zero known P0 safety, data-integrity, routing, privacy, billing or rollback
  defects. Remaining P1 issues require named owners and explicit approval.
- Written approval with dated evidence for each gate. Two successive green
  release-candidate runs without a new blocker are a suggested release policy.

## Evidence currently missing

- The local API build warned that the compressed transit snapshot was missing.
  Neither licensed live timetable coverage nor freshness was independently
  verified against actual railway journeys.
- Pedestrian barrier/entrance and iOS/Android itinerary parity are unverified.
- Signed-device OS alerts, SecureStore upgrade/backup and real purchase restore
  are not verified in this engineering review.
- Public store compliance, deployment links, rollback and monitoring have not
  been independently approved.

**Decision rule:** say "good stopping point to deploy" only when Stage 1 or
Stage 2 requirements are evidenced on a specific candidate, and report which
stage. Never automatically merge, deploy or publish based on a CI badge.
