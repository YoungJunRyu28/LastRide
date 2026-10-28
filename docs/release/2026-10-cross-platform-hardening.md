# LastRide — cross-platform production hardening program (2026-10-16)

Base: `a8dcdf4282fc4c6d1ab9d7f60d1f82b359cfd977`. Owner review required; no automatic merge, store submission or production mutation.

## Contract: separate evidence from readiness
- **Implemented**: source changed and regression test exists.
- **Verified**: typecheck, automated tests, codegen checks, and iOS/Android bundle/native prebuild pass on the exact commit.
- **External gate**: requires credentials, app-store roles, signed builds, production infrastructure, or real hardware. Cannot be marked complete through source inspection.

## Release blocking workstreams (P0)
| ID | Workstream | Changes & acceptance conditions | Platform |
| --- | --- | --- | --- |
| R01 | Ownership/recovery | Serialize local membership and sharing mutations; refuse destructive reset on unsuccessful remote leave; devise authenticated host recovery and server-side idempotent create/join tokens | both |
| R02 | Push/alerts | Transactional or durable per-recipient notification outbox, bounded retries, Expo ticket/receipt reconciliation, notification permission/token refresh, deterministic due-scheduler ownership and outage replay | both |
| R03 | Link routing | `/join` and `/group-join` supported by Android intent filters, iOS AASA and route handlers. Host production Android Digital Asset Links JSON using **actual Play app-signing SHA-256**. Prove via fresh installation `adb shell pm get-app-links` | both |
| R04 | Functional trip accuracy | Replace Android empty address/nearby APIs and incomplete ODPT coverage with audited full Japan provider/fallback; validate actual Tokyo/JR/private transfers, holidays, midnight, GPS drift and station entrances | Android and shared |
| R05 | Platform crash safety | Validate map snapshot coordinates, span and size on both JS and Swift boundary; run iOS simulator and real-device regression against historical `MKMapSnapshotOptions setRegion` crash; cross-check AlarmKit permissions | iOS |
| R06 | Privacy/security | Remove PII from error/exception messages, audit token permissions, validate purchase proof with server-bound identity, fix relevant dependency advisories, cover abuse/rate limits and production secrets | both |
| R07 | Data & scheduler integrity | Align container and scheduled Lambda cleanup, scheduler CAS/leases, idempotent group creation, revision-based refresh without stale response clobber | server and both |
| R08 | Release pipeline | Assert production capability flags, native entitlements, EAS/Firebase/APNs credentials, privacy declarations, App Store/Play metadata, migration smoke check, staged releases and rollback drill | both |

## Execution stages
### Phase A — deterministic code safety (PR stage)
1. Lock every group-capability AsyncStorage read-modify-write operation and test 20+ parallel operations, failure recovery, and clear racing against save.
2. Fix notification navigation for group-only members; add gate regression coverage.
3. Register correct Android App Links paths; enforce with an app-config test. Do not invent a signing fingerprint.
4. Validate MapKit snapshots before region assignment to prevent Swift NSException; test malformed point guards at JS boundary.
5. Prevent raw query strings leaking through HTTP parse-error exception messages.
6. Align inactive group cleanup between Lambda and long-running server.
7. Make group-leave reset fail closed rather than claim disbanding when offline.
8. Prevent stale group GET overwriting successful group mutation results.
9. Run all tests, typecheck, generation checks, and both platform bundles. Keep a change log for each fix.

### Phase B — durable notifications and account recovery
1. Add a database-backed **recipient-level** outbox with stable event keys; use lease, attempt count, next-attempt timestamp, TTL and unique index.
2. Process Expo push tickets/receipts; distinguish retryable failures and permanently invalid tokens.
3. Keep a retryable host/member identity recovery record. Rotate exposed credentials and design opt-in restore across devices.
4. Validate entitlement and trial/renewal/revocation at server based on a bound customer identity.
5. Add DB-backed simulations of concurrency, crashes between each transaction and push, eventual recovery.
**Gate:** load-tested 50-person groups and zero unacknowledged alert losses under injected transient outage; any at-least-once duplicates documented.

### Phase C — Japanese transit and real geography
1. Construct a reproducible operator/station/stop coverage report for ODPT, supplement providers and transit fallback.
2. Provide geocoder/nearby places backend for Android; route-aware walking and taxi estimation (or transparent unavailable state).
3. Run a curated golden corpus (JR/private, line transfer, overnight, holiday, accessibility, station exits, unusual weather).
4. Enforce timetable snapshot freshness and independent disruption feed health.
**Gate:** same-trip leave-by comparisons iOS/Android with explicit quality tolerance and no fabricated train availability.

### Phase D — release qualification
1. Device matrix: small/large iPhones, representative Android 12–16, Japanese and English, accessibility/large text; permissions never/once/always, background/Doze/Focus, low power, offline/reconnect and data wipe.
2. Lifecycle: fresh install → onboard → plan → share group → notification → leave → disband → reinstall/restore; 50-member concurrency and unusual names.
3. Payments: RevenueCat sandbox, refund, cancellation, restore on same platform, cross-platform identity design.
4. Infrastructure: staging database backup/restore, migrations, deployment and rollback, scheduler alarms and receipt logs.
5. Security: capability/token leak tests, request limits, Sentry sanitization; store privacy disclosures and screenshots.
6. Verify signed iOS archive/TestFlight + Play-signed Android AAB with explicit feature flags, entitlement manifest and real push delivered to a locked phone.
**Gate:** no open P0/P1, no flaky critical E2E, actual signed devices validated, store review accepted.

## Important boundaries
The CI passing does not imply real push receipt, accurate Android train plans, signing, or live App Links verification. Every external gate is explicitly pending until its real environment is checked. Do not delete or overwrite pre-existing uncommitted work. Never claim complete platform parity solely from bundling.

## Initial evidence and open risk
Previous baseline: 215 mobile + 74 selected server tests passed; TS check and iOS/Android/web export passed. Confirmed regressions: Android `/group-join` absent from intent filters; production `/.well-known/assetlinks.json` 404; concurrent `saveMembership` loses one member; old iOS simulator `MKMapSnapshotOptions.setRegion` exception traces; full production iOS push/Universal Link/Live Activity flags not verified. 5 production-dependency advisories were observed; priority requires reachability and patched versions check.

## Do not ship based on an aggregate numerical score alone
Release requires every hard gate above, with independent review of changes to billing/authentication and background alarms.

## Phase A implementation record — review branch (2026-10-16)

| Checkpoint | Evidence / change | Remaining requirement |
| --- | --- | --- |
| A1 group capability storage | `groupMemberships.ts` serial mutations and fail-closed read/parse failures; new 20-concurrent-join, clear, rename, remove and failure-injection tests | Cross-device account/host recovery remains R01 |
| A2 background sharing | `groupSharing.ts` serialized per-device writes; error propagation, 20 simultaneous groups tests | Persist retry queue across failed location callbacks |
| A3 live group state | `GroupRefreshGuard` prevents stale GET / stale 404 overriding later mutations | Periodic refresh while group screen visible, offline sync |
| A4 destructive reset | Remote group disband/leave must succeed (or already be 404) before local credentials are deleted; failed reset shows localized alert | Crash-resumable reset with multi-group partial success |
| A5 app linking | Android native intent filters support both `/join` and `/group-join`; generator validates genuine Play SHA-256; explicit JSON MIME type | **P0 OPEN**: deploy generated JSON with real Play signing fingerprint. Live `https://lastride.jp/.well-known/assetlinks.json` was HTTP 404. Verify Play-signed install |
| A6 platform crash protection | Swift `snapshot` guard before Objective-C MapKit region setter and JS map-frame validation; malformed-input tests | Real iOS native compile plus historical simulator/physical device repro |
| A7 push retry | Exactly-claimed group leave-time alert is reopened when Expo accepts **zero** notification tickets; test for rejection, success, no recipients | **P0 OPEN**: durable recipient-level outbox and Expo delivery receipt reconciliation |
| A8 push token lifecycle | Existing groups re-register on app foreground/language or OS push-token change, null unregisters; no extra permission prompt | Physical APNs/FCM checks, permissions and Doze/Focus |
| A9 local navigation | Group alert taps route to groups without a home station; pure gate tests cover personal/business distinctions | Signed deep-link E2E |
| A10 planner robustness | A failed destination route lookup does not discard successful routes to other destinations | **P0 OPEN**: complete Android rail, address and walking route parity |
| A11 container cleanup | Long-running Express runtime also purges inactive group members like scheduled Lambda | Live metrics, tested 180-day policy |
| A12 privacy | Parse errors and ApiError no longer attach URL query strings to messages/URL properties | Audit all other PII fields and Sentry runtime |
| A13 production build gates | Fail closed if release enables no remote push or Universal Links, alongside mandatory HTTPS API; tests updated | EAS env, signed entitlements, review/approval |
| A14 dependency advisories | `compression@1.8.1` patched to 1.8.2 | **2 high advisories without patched same-major release** (`node-forge`, `braces`); remaining moderate transitive dependencies need remediation |

### Backlog / explicit blockers not implied fixed by Phase A
- Group host creation crash/restore and cross-device transfer, real purchase proof binding, durable push outbox and background OS guarantees.
- Android JR/private rail parity, real geocoding/nearby and honest walking/taxi ETA; upstream snapshot freshness guard and independent disruption health.
- Production assetlinks deployment, signing certificate, Play Console declarations, iOS TestFlight archive, group-device E2E and payment sandbox.
- CI with ephemeral PostgreSQL and migration/row-level lock tests must be verified after PR creation; local macOS shell may not provide Postgres.
- Postfix remediation must be verified before assigning new overall readiness scores. **Do not market this patch as a complete production release.**

### Reviewer checklist
- Review signed entitlement/test path, Android assetlinks certificate choice, failure cases for reset and retry.
- Verify no production data migration or external account was touched during development.
- Run GitHub CI on the actual PR SHA. Repeat release preflight on the signed bundle before merging.

### Publishing limitation
The personal GitHub account can write repository files but lacks OAuth `workflow` scope. The existing `.github/workflows/ci.yml` is intentionally left unchanged; run the three Android Asset Links generator tests manually (`node --test scripts/generate-android-assetlinks.test.mjs`) until someone with workflow-editing permission incorporates them into CI.

## Phase B work in the next commit — durable departure notifications

**Schema:** `lib/db/drizzle/0012_lame_songbird.sql` adds `group_alert_deliveries`. Every row belongs to a `group_nights` row with `ON DELETE CASCADE`, so private departure times and Expo receipts are purged when the night is deleted. Do not broaden retention.

**Algorithm:** (1) the existing conditional leave-time claim is committed together with an outbox row per opted-in recipient, (2) a worker takes batches using `FOR UPDATE SKIP LOCKED` and a 45-second lease, (3) Expo is called in batches and each ticket accepted or retried individually, (4) the scheduler considers both new due departures and outbox retry times, (5) a separate receipt job marks ticket outcomes and only invalidates the exact device token used when it was accepted. Failed writes leave an expiring lease rather than dropping the delivery. The retry is at-least-once, not exactly-once: a crash after Expo receives a ticket but before its ID is recorded can cause a duplicate.

**IMPORTANT rollout:** apply the additive DB migration **before** deploying any server/Lambda code that reads or writes the outbox table. Otherwise departure workers and scheduler lookups will fail. Perform a staging migration and restore rehearsal before production. The repository CI uses ephemeral PostgreSQL and applies committed migrations, but does not authorize a production migration.

**Known limitations:** group-start and silent group-update messages remain best effort; outbox covers **departure** alerts. The 10-minute grace window prevents stale notifications from being delivered too late. Expo acceptance only confirms receipt by Expo, not a locked-phone delivery guarantee. Native APNs and Firebase credentials/receipts still require signed physical-device verification. The EventBridge update race is now guarded by a database advisory lock, but external AWS failures, unsupported rail operators and group-account recovery remain independent P1/P0 risks.

### Phase B group UI recovery
Group list and group detail now re-fetch the latest server state when focused, and support native pull-to-refresh. This avoids polling every connected device continuously but does **not** make dropped silent pushes impossible; visible screens may remain stale until manually refreshed. Tests also cover changed leave times and notification opt-out after an alert has been queued.

### Phase B concurrent schedule update protection
One-time EventBridge schedule read/modify/write now happens while holding a transaction-scoped PostgreSQL advisory lock (key `472281, 7310`), so two Lambda instances cannot concurrently overwrite a newly advanced schedule. Both departure-time and retry-time lookups use the **same transaction client** to avoid pool exhaustion/deadlock at the production pool size of two. An integration regression starts overlapping lock holders and verifies serialized execution. Network/AWS failures can still prevent the external schedule from updating; the fallback EventBridge check remains mandatory and monitoring still needs to be added.

## Phase B group creation recovery (migration 0013)

Group creation now accepts an **optional** `X-Group-Create-Key` header for backwards compatibility with older app binaries. The client generates a native securely random 32-byte token with `expo-crypto`, persists it to AsyncStorage **before** sending a paid-group request, and reuses it for every retry. For new clients, this token also becomes the host capability. The server stores only its SHA-256 hash, in the new nullable, unique `groups.creation_key_hash` column. A repeat request with the same key returns HTTP 200 and the existing host's original credential/group detail; the first succeeds with HTTP 201. Concurrent retries converge on one row because of a database unique constraint. Replay returns the previously created group even if the Premium entitlement has since expired; **new** groups still require the server RevenueCat check. Recovery cannot create another group if the pending key cannot be persisted or the previous creation is unresolved. The UI pre-fills pending details; restart triggers a best-effort retry.

**Operational constraints:** apply `0013_true_hemingway.sql` before shipping the updated backend. The header is a host credential; never log or include it in crash analytics. The pending token is stored on the device, not an account-based restore service; loss of local storage or reinstall without backup is still an unresolved cross-device recovery issue. The reset flow refuses to forget a pending creation rather than strand an unknown host. Legacy clients without the new header still create groups but do not gain retry recovery; old groups have NULL creation hashes. Production release requires a signed-device crash/restart/replay test on iOS and Android.

### Phase B group join loss/recovery

The optional `X-Group-Join-Key` header extends idempotent membership to anonymous users without requiring sign-in. The device persists a native securely random 256-bit `joinKey` with its pending invite/code and display name before posting. **Only on the initial successful join** the server stores its hash as `group_members.member_token_hash`, the same stored anonymous capability hash as existing memberships. The group-row transaction lock prevents concurrent duplicated members, and a replay of that capability restores membership even after the inviter rotates their join link. Success deletes the pending state **after** persisting membership; interrupted submissions are retried on app restart. The UI disallows changing invites while a prior join is unresolved. Older clients without this header still work but cannot recover a lost response without rejoining. Reset refuses to erase local state while an unresolved join key exists.

This join change does **not** require another DB migration beyond `0013`. **Do not** log the capability; it grants member access. Deleting the app without backed-up data still destroys the only local member credential. Full account-based cross-device recovery remains unsolved.

**Definitive rejection versus transient outage:** the client retains pending capability keys when a request times out, is interrupted, or returns 5xx. It clears a creation key only when the backend definitively refuses creation (400 invalid / 402 Premium required), and clears a join key when the backend definitively rejects an invite (400 invalid/revoked / 409 full). A replay of an already-committed host/member credential returns HTTP 200 before these errors, so this prevents users becoming stuck forever with an invalid invite without risking the loss of a credential from a successfully created group.

## Phase C Android native Google Maps + no-Places-cost address lookup

**Implementation:** `expo-maps@57.0.4` on Android renders **Google Maps SDK for Android** instead of the static illustrated placeholder when `EXPO_ANDROID_GOOGLE_MAPS_API_KEY` exists at native build time. iOS retains the existing Apple MapKit snapshot. The native map renders markers from current device-side coordinates and bounded/validated route polylines only when actual polyline geometry exists. **No real route geometry = no fake straight-line road**; walking minutes on the Android map are prefixed with `≈` because the LastRide `/walk` server currently calculates distance ×1.3, not a route that avoids obstacles. Tapping opens walking/transit directions in the user's external Google Maps app. The illustrated fallback is labeled as an unavailable preview when an Android key is missing.

**Android geocoding:** `expo-location.geocodeAsync` (device OS geocoder) returns single-address coordinates where native geocoding is supported. The UI throttles address query to 450 ms, shows permission/lookup failures, and won't ask for foreground location permission unexpectedly for every keystroke. Repeated duplicates, nonfinite positions, and excessive result counts are filtered. This is **not** paid Places Autocomplete and does not guarantee search-as-you-type suggestions; partial addresses may fail to resolve. The server's `/addresses/search` remains the empty/error-proof fallback, and no external community address API is queried in production. Android rail station discovery and complete Japanese train schedules **are not** solved by adding a map.

### Build and key configuration (manual Google Cloud action required)

1. Set up Google Cloud billing, enable **Maps SDK for Android** (do **not** enable paid Places/Routes APIs just to display the map). Mobile native Maps SDK map loads have an unlimited no-charge SKU under Google's current pricing; other APIs have distinct quotas and paid tiers.
2. Create a Google Cloud **Android-restricted API key**, restrict APIs to **Maps SDK for Android**, restrict Android package to `jp.lastride.app`, and add the correct **SHA-1 signing certificate fingerprint**: Play Console **App signing certificate** for Google Play distribution. Use a separate restricted key, or add EAS's debug/preview signing fingerprint for internal builds. App signing SHA-1 is not the same as the upload key or SHA-256 used for Android Asset Links.
3. Store the key in EAS `production`/`preview` environment settings as **`EXPO_ANDROID_GOOGLE_MAPS_API_KEY`** with `sensitive` visibility, not `EXPO_PUBLIC_*`, and never commit it to the repository or hardcode it in `app.json`. It is injected into the Android native manifest during prebuild; clients can extract installed native API keys, so package+fingerprint+API restrictions are essential.
4. Production **Android** builds fail explicitly if the key is absent or malformed; production **iOS** builds do not require it (`EAS_BUILD_PLATFORM=ios`). Preview/local builds without a key show the labeled fallback, not a blank Google tile grid. Rebuild the native binary after changing the key; OTA JS updates alone cannot add a native API key.
5. Confirm the map renders Google branding/attribution unobscured on **physical Android devices**, on Wi-Fi/cellular, with Google Play Services enabled/disabled where relevant. Verify revoked key/no-tiles handling, location permission rejection, Tokyo station-to-station zoom, and Android OS geocoder accuracy on real Japanese addresses. The `expo-maps` library is alpha; typechecks and generated native projects cannot replace a physically executed signed Play build.

### Remaining critical release gaps

**P0**: The shared API currently loads a limited licensed ODPT transit snapshot and does not offer full JR/private-line last-train parity with iOS MapKit. The app's Android server walking time is an *estimate* from straight-line distance and can be very wrong across barriers/complex stations. Build a validated Japan routing/timetable provider and an iOS-versus-Android journey fixture corpus before Play launch. Actual Google Maps SDK map tiles **do not** grant free Google Routes/Places data access. Do not call the existing transit/ETA backend "fully error-free" until coverage, live data freshness, signed-device tests and provider failure testing are done.

### Timetable backend fail-closed deployment preflight

The SAM deploy script now validates the compressed snapshot **before secrets/database changes**: parseable gzip, version 1, a timezone-aware generation timestamp within **30 days** (configurable via `TRANSIT_SNAPSHOT_MAX_AGE_DAYS`), no future-dated generation beyond 15 min, nonempty sources with declared licenses, station list, service calendar and trips, valid station coordinates and trip references. Invalid/stale/missing files fail deployment, preventing a new backend release from serving dangerously old data. Tests synthesize gzipped snapshots; CI does not and cannot exercise live ODPT coverage without a licensed key. **This gate only proves export freshness, not that licensed operator schedules are current or that JR/private routes are covered.**

### Native build evidence (no production credential)

A clean Expo Android prebuild generated the native manifest `com.google.android.geo.API_KEY` metadata with a **syntactically valid dummy key**. `./gradlew :app:assembleDebug` compiled successfully on the connected macOS workstation with **JDK 21** and the Expo Maps module included. JDK 25 initially failed in CMake configuration of pre-existing React Native worklets/Expo updates, so use JDK 21 for reproducible native builds. The APK is **debug-signed, contains a dummy key, and was not installed on a physical device**; Google Maps tile loading needs actual Google Cloud billing, restricted key and SHA-1 signing certificate. Metro exports for iOS/Android/web also succeeded. No Play Store or TestFlight deployment was performed.

## iOS AlarmKit reconciliation (2026-10-19)

Previously a cached reminder signature and an ordinary scheduled notification
were considered enough to skip an unchanged plan. On iOS 26+, LastRide schedules
an actual AlarmKit alarm **and** a *silent, passive* companion notification.
If iOS removed the AlarmKit alarm but left that companion, the app could falsely
report an intact schedule and never restore the audible alarm. This is a
critical correctness issue for a last-train reminder.

The iOS `LastRideAlarm` Expo native module now exposes
`scheduledAlarmIds()` through `AlarmManager.shared.alarms`. The JS wrapper
returns `null` if the bridge/OS query fails; **unknown is not healthy**.
When each AlarmKit UUID is successfully scheduled, the app persists its UUID
and fire time in `lastride-scheduled-alarmkit-v1`, separate from the local
notification ledger. An AlarmKit companion receives a specific
`lastrideAlarmCompanion` marker in the notification's data payload so the app
can distinguish it from an audible fallback without relying on unsupported
native response properties. On an unchanged plan, the OS notifications, the
native alarm receipt count, and the native AlarmKit identifiers must all agree.
If they don't, LastRide cancels its own native alarms and recreates the plan.

Scheduler version **10** invalidates signatures written by older releases
that could not verify native alarms. A native AlarmKit schedule that succeeded
but whose receipt write failed still gets its *quiet companion*, not an
additional audible notification; the scheduler deliberately withholds the
cache signature so a future replan checks again. Cancellation removes both
ledgers and attempts to clear the native AlarmKit alarms.

New regression tests simulate (1) a real alarm disappearing while the silent
companion remains, (2) a missing persisted alarm receipt, (3) a failed native
scheduled-ID query, (4) an unauthorized alarm falling back to a regular
notification, and (5) receipt persistence failing after the native alarm was
successfully created. Unit tests cannot guarantee delivery under Focus,
Low Power Mode, app termination or background scheduling restrictions.

**Release gate:** Run this on a signed iOS 26+ iPhone with AlarmKit permission,
force-stop/restart the app, change permission in Settings, test a background
reminder, confirm both native and companion behavior, and check restoration
when the system removes an alarm. Older iOS versions must fall back to Time
Sensitive notifications and cannot promise AlarmKit-level guarantees.

## Durable group leave-time delivery (2026-10-19)

**Risk LR-038:** `syncSharedLeaveBy` previously sent changes only from a
location-update callback, and failed requests were discarded. When offline,
iOS can suspend a stationary device indefinitely; a later network recovery
alone would not trigger another location callback. Friends could keep an
outdated last-train departure time despite the member still opting in.

Now `groupSharing.ts` stores the last server-acknowledged leave times under
`lastride-group-sharing` and independently stores the most recent **desired**
leave time per group in `lastride-group-leave-outbox-v1`. It commits this
record **before** sending HTTP; a network failure, killed app or API 503
leaves the pending value for another attempt. Success updates the local
acknowledged value and deletes its pending entry. Both foreground
`GroupsContext` changes and headless GPS callbacks use the same serialized
request path; foreground sends return the server's updated group for UI.
`null` (clearing a departure time while remaining opted into the group) is
queued and retried exactly like a concrete departure time.

The app replays pending changes on return to foreground and every 30 seconds
**while active**. Overlapping timers coalesce, and when the queue is empty no
HTTP request or membership lookup occurs. The first network/transient server
failure stops that replay pass to avoid many expensive sequential timeouts
on unreliable mobile connections. Every request has a 12-second abort timeout.
A 404 (removed membership) or 409 (ended night) clears the corresponding
opt-in and pending request. A user leaving a group, opting out tonight or
resetting the app also removes pending updates; an in-flight acknowledgment
cannot recreate an opt-in they removed. Outbox entries older than **8 hours**
or dated unexpectedly far into the future are discarded instead of sending
a past night's leave time. No location, route, station, or destination is
included in the outbox or sent to the group API.

**Verification:** Group API mocks cover offline retry after app resumption,
latest-value replacement, never reviving opt-outs, older-night expiry,
reset, terminal vs transient errors, membership-token absence, failed local
writes, overlapping retries, in-flight opt-outs, multi-group outage limits,
foreground single-group responses and queued `null` clears. Real signed iOS
and Android multi-device QA is still required, including Wi-Fi→cellular
handoff, background suspension, force-quit, loss of location permission,
server/group closure and group-join/leave during in-flight HTTP.

**Limitation:** iOS may not wake a force-quit app on connectivity recovery.
Pending delivery happens only on a later allowed foreground/background
execution; this improves eventual consistency but cannot promise immediate
remote group updates or rescue a missed last train without the OS running
LastRide. Multiple independent JS runtimes and devices cannot guarantee
strict global request ordering without a server-side version/sequence
protocol. Further server-side conflict resolution and physical-device chaos
QA remain release work.

## Group leave-time ordering across server workers and iOS/Android runtimes (2026-10-20)

The durable client outbox alone did **not** guarantee correct ordering:
parallel network requests from two React Native/Expo TaskManager runtimes or
multiple devices could arrive out of order. An old queued leave time might
then overwrite a newer one and cause misleading group departure alerts.

**Implemented:** database migration `0014_cooing_monster_badoon.sql`
adds `group_night_participants.leave_revision INTEGER NOT NULL DEFAULT 0`.
Version `0` identifies pre-protocol (legacy) participation rows. The API now
includes each participant's `leaveRevision` in `GroupDetail` and optionally
accepts `X-Leave-Expected-Revision` on `PUT /groups/:groupId/tonight/me`.
A new client snapshots the server-observed revision **at the moment its desired
leave time is queued** and persists that precondition in AsyncStorage. The
server uses one PostgreSQL `INSERT ... ON CONFLICT DO UPDATE ... WHERE
leave_revision = expected` statement to atomically accept an unmodified
version and increment it; conflicting writes update zero rows and receive
HTTP **412** with `STALE_LEAVE_REVISION`. Client retries never refresh an old
queued request's precondition to sneak an obsolete time through. A 412 drops
that old operation and attempts to refresh the latest server participant
state without opting out; fresh subsequent changes use the new revision.
This covers `null` leave-time clears as well.

**Compatibility:** older clients that omit the new header may still write an
untouched revision-0 row. Once any CAS-aware client updates that group member
for tonight, legacy unversioned PUTs receive 412 instead of overwriting the
new version. This is intentional fail-closed behavior but may affect older
clients; it requires release-stage adoption metrics, upgrade guidance and
rollback planning. Old apps are not capable of recognizing the new machine
error, and should not be promised a seamless experience. Versioning is
night-scoped and resets on a newly created night. The schema migration must be
applied before deploying code that reads/writes `leave_revision`; never deploy
the new API to an unmigrated database.

**Evidence and limits:** PostgreSQL-backed HTTP tests exercise stale arrival,
legacy downgrade, competing first writes and malformed revision headers.
Mobile tests cover pinned offline CAS versions, conflict refresh, next-write
revision increment and corrupt storage fail-closed behavior. The server is the
serialization authority for one member's record; this does not decide which
human/device has the *right* departure plan. Cross-device identity arbitration,
alert-delivery SLOs and two-device real iPhone/Android chaos testing are still
release blockers. No production database migration has been performed.

## Alert scheduler disaster recovery and push receipts (2026-10-21)

**P1 schedule-loss defect:** the EventBridge one-time schedule occasionally
fails to be updated (permissions, AWS outage, throttling, Lambda crash). The
old recovery `DepartureAlerts` cron ran once per **30 minutes** but the server
expires a pending group leave-time reminder **10 minutes** after its due time.
An alert due right after the previous fallback run could therefore *never*
be delivered. Additionally, the old backup ran only 20:00–01:59 JST, even
though a group night covers the Japan rail service day through 08:00 JST.

The SAM fallback now runs **every 5 minutes, 24 hours a day** and still uses
its own SQS dead-letter queue and EventBridge retry policy. The 10-minute
alert grace leaves a scheduling margin in normal operation (not a hard
end-to-end delivery SLO, since EventBridge/Lambda/DB/Expo can be delayed).
Event-driven one-time alert scheduling remains the primary path and still
serializes updates through a PostgreSQL advisory lock. In the scheduled Lambda,
`Promise.allSettled` now allows group alert dispatch and Scheduler re-arming
to proceed even if the independent Business alert dispatcher throws; failures
are still rethrown after group work to activate Lambda retries and alarms.

**Operational cost gate:** this is a **correctness-over-free-tier-cost** change:
288 fallback invocations/day and database activity every five minutes can
keep Neon compute awake continuously, potentially far exceeding the project's
previous **100 CU-hours/month** free-tier assumption. Before production:
measure expected CU-hours and AWS costs, set Neon and AWS budget alarms,
provision a paid tier if necessary, and consider a separately tested
*low-cost* recovery architecture that provides equal alert guarantees without
continuous database polls. Production deployment requires
`LASTRIDE_ALERT_RECOVERY_COST_APPROVED=yes` only **after** an actual cost and
budget-alert review; staging remains usable without it. The flag is an
attestation, not a billing-control mechanism. Never loosen this watchdog back to >10 minutes
without changing the expiry/safety model and validating the resulting UX.

> **Update (low-cost recovery):** the all-day five-minute backup was replaced by
> an architecture with the same alert guarantee that leaves the database asleep:
> an on-demand watchdog (EventBridge `rate(5 minutes)`, created only while group
> alerts are pending and ending 15 minutes after the last), group receipt checks
> and 2-hour ticket expiry on the existing one-time schedule, a night backstop
> every 30 minutes 20:00–01:59 JST that skips the database while the watchdog
> runs, and the receipt job back to daily at 08:10. `check-alert-recovery-budget.mjs`
> now checks the template instead of requiring an approval flag. See
> `artifacts/api-server/src/lib/leaveAlertSchedule.ts`.

**Receipts:** `PushReceipts` was configured as DISABLED whenever `EnableBusiness`
was false, even though it processes *consumer group* Expo push receipts too.
Now group receipts run every 15 minutes during 18:00–07:59 JST even with
Business disabled, plus a separate 08:00 run before the 08:05 nightly privacy
purge. Distinct SAM ScheduleV2 events get distinct SQS dead-letter queues.
The group receipt handler continues if Business receipt processing fails;
failure status is still returned to trigger EventBridge retry/CloudWatch
alerts. This reveals unregistered push tokens and other Expo receipt failures
before future alerts are sent to the same device.

**Known limitation:** group receipt rows cascade away when the night is purged
at 08:05 JST. Expo receipts may not yet be available for pushes delivered in
the last ~15 minutes of the night; an 08:00 receipt check does not make them
retroactively available. Do NOT claim 100% APNs/FCM receipt reconciliation
without redesigning privacy-preserving short-term delivery receipt retention
or the nightly deletion window, and securing a retention-policy decision.
Receipt acceptance/Expo confirmation still does **not** prove iOS Focus,
APNs, or Android FCM displayed the notification to a user.

**Tests:** `scripts/verify-alert-schedules.test.mjs` checks that fallback
frequency stays safely inside the grace window, covers all JST hours, and
receipt checks remain active independently of Business and precede cleanup.
`artifacts/api-server/tests/scheduledReliability.test.ts` failure-injects
separate Business and group worker failures and verifies schedule re-arming,
receipt checks, and error propagation. Native signed-device chaos tests and
live AWS Scheduler/DLQ alarm drills remain release blockers.

## Opaque late-night push-receipt reconciliation (2026-10-22)

**Correctness and privacy issue LR-031:** `group_alert_deliveries` uses a foreign
key with `ON DELETE CASCADE` to its group night. The 08:05 JST cleanup erases
all private departure times, as intended, but also erased still-unchecked Expo
push tickets. Expo may not make receipts available until ~15 minutes after
acceptance, so even the final 08:00 receipt poll could not check the final
few minutes of a night. A push token that Expo rejected as
`DeviceNotRegistered` could remain active and produce repeated failures.

**Implementation (migration 0015):** each *accepted* Expo ticket now creates a
small journal row `group_push_receipt_checks` in the **same transaction** as
marking the main per-recipient delivery accepted. It stores only an opaque Expo
receipt ticket ID, a **SHA-256 digest of the push token**, recipient member ID
and delivery ID (nullable FKs with `ON DELETE SET NULL`), sent time, and a
fixed **two-hour expiry**. It deliberately does **not** retain a group name,
invite, user display name, location, station, leave-by time, transit route, or
raw push token. Note that the member-ID link still temporarily permits
association to an existing group, so this is *minimized* data, not fully
anonymous data. At group-night purge the private sender, departure and alert
records disappear immediately; its receipt-only reference becomes null while
the minimal pending verification row remains for at most the short expiry
window, subject to scheduled TTL garbage collection.

The receipt worker runs every **15 minutes all day**, including after 08:05,
checks pending tickets at least 15 minutes old and *deletes* each receipt row
atomically after processing it (including successful, invalid, and rotated
push-token results). Missing Expo receipts are retried only while unexpired.
Expired rows are deleted before processing on each scheduled run; if AWS
Scheduler/Lambda goes down, physical removal can lag until the next healthy
run. A `DeviceNotRegistered` result only clears a member's current token if
its SHA-256 digest still matches the token from the accepted ticket, and the
SQL update also checks the unchanged raw token. A rotated/new push token can
never be revoked by an old receipt. Simultaneous workers cannot both process
one ticket because they delete it using a transactional row claim.

On migration, only legacy unresolved accepted tickets sent within the last
two hours are migrated from the old delivery ledger; the source trip record
still cascades away at night cleanup. No previously expired ticket is copied.
The journal is intentionally distinct from the private group-night retention
policy, but **retention-policy owner approval is required before public
production rollout (`LASTRIDE_GROUP_RECEIPT_RETENTION_APPROVED=yes` after
review)**. It is a proposed short-lived operational record and
cannot be justified merely by a passing test suite.

The release tests use a real PostgreSQL test DB to validate that a 07:50 JST
receipt can be checked after night deletion, with `deliveryId = null`, and
that an old `DeviceNotRegistered` receipt cannot revoke a rotated token. TTL
expiry and raw-push-token exclusion are covered. The hosted Expo endpoint is
stubbed: signed iPhone APNs/Android FCM delivery and Expo live receipt delay
still require staging verification. This does not prove the user saw the
alert, and Expo never guarantees handset notification display.

### Review finding: malformed Expo receipt cannot erase the last verification ticket (2026-10-22)

During independent PR #41 review, we found a fail-open case in the new
post-night receipt processor: any truthy `data[ticketId]` value, including a
missing `status`, was treated as a successful receipt and its verification
row was permanently deleted. HTTP 200 is transport success, **not** proof
that Expo delivered the ticket. The processor now consumes a ticket **only**
when Expo explicitly reports terminal `status: "ok"` or `status: "error"`.
Missing/unrecognized per-ticket results remain in the two-hour queue for a
later check; malformed top-level envelopes or API errors cause an exception
so the scheduled Lambda reports a failure instead of silently counting it.
Warnings identify only the internal receipt-row UUID; no token, group or
journey information is logged. Unresolved verification records still expire
at the short retention deadline. PostgreSQL integration regression exercises
malformed HTTP-200 response, persistence beyond group-night deletion and
successful later receipt reconciliation; unit tests validate terminal state
and top-level envelope parsing.

## Route confidence in last-train departure planning (2026-10-22)

**P0 risk LR-035:** `GET /walk`, Android/ODPT nearby-station walking minutes,
and fallback paths used a **straight-line distance × 1.3** as if it were
street-verified pedestrian routing. These can be dangerously wrong around
rail yards, rivers, overpasses, closed passages, stair-only accesses and
complex station entrances. Three minutes of station-entry time alone does not
bound these errors. Earlier UI did not distinguish a routed MapKit walk from
the heuristic in its last-train countdown/reminders.

**Fix in PR #41:** Walking data now carries a provenance distinction:
`source: 'routed'` for a valid MapKit pedestrian-route result (or the
non-production OSM foot-routing tool), versus `source: 'estimated'` for every
LastRide server walking response, ODPT-nearby walking time and geometric
fallback. The OpenAPI `/walk` endpoint explicitly advertises only
`estimated`, and the nearby-station response includes
`walkingSource: estimated`; generated clients are updated. Native MapKit
results with non-finite/negative ETA or distance are not promoted to routed.
This provenance is carried in planner station choices, alternatives, pinned
stations and margin updates; unknown older stored plans are deliberately
treated as **estimated**, not trusted as routed.

**Departure effect:** Besides the user's selected 余裕 margin, an unverified
walk reserves an **extra** 3–15 minutes (ceil(35% of the approximated walking
minutes), with a 3-minute floor and 15-minute cap). Existing transfer and
long-walk margins remain additive. This is a cautious product heuristic,
**not** an empirically calibrated confidence interval or proof a train can be
reached. The train departure time and theoretical walk ETA are unchanged;
only the **recommended** departure / notifications move earlier. Real MapKit
street routes retain the existing margin behavior. Nightly cached plans
written before this change are retained offline, but their recommended
reminder is shifted earlier and their provenance shown as unknown/estimated;
newly saved versioned plans are not penalized again on reload.

**Clear user disclosure:** On the ride screen, map walking-time label and
alternative/pinned station rows, unverified walking minutes are annotated
as a **walk estimate** (徒歩推定 / estimate). A visible bilingual warning says
the route may require detours or different station entrances and is an
accessible button opening real **walking directions to that station** in
Apple Maps / Google Maps. The normal map tap still opens the complete
public-transit journey home. This avoids inviting the user to confirm the
walking segment through a transit-only map route.

**Verification:** HTTP fixture checks for `/walk` and `/stations/nearby`
assert `estimated` provenance; mobile planner tests cover explicit routed vs
estimated margins, earlier leave-now alarms, zero user margin, capped long
walks, old saved plans, station pin/repick and margin updates. Offline saved
plan tests ensure a legacy plan stays available but warns/advances the leave
recommendation without double-applying buffers on future loads.

**Unresolved P0:** The Android production backend still lacks an actual
licensed pedestrian routing provider; ±35% padding plus a 15-minute cap is
not reliable for many geography constraints. No real ground-truth walking
routes, closed entrances, pedestrian accessibility, operator timetables,
real disruption coverage or end-to-end measured latest-train catch rate have
been validated. Do **not** use this change as evidence LastRide can promise
"you will catch the train" or as approval for public release. A proper
pedestrian router with route geometry/ETA, field-verified station entrances
and licensed JR/private railway timetable coverage are still required.
