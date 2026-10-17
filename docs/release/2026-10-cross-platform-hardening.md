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
