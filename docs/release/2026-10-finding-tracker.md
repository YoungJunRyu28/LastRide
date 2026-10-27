# LastRide — 58-findings remediation tracker (October 2026)

This records the 58 findings from the static source audit. **Fixed** means the code issue has a regression check; it does **not** mean the store release is approved. **Partial** means a meaningful improvement was made but the original release gate remains open. **Pending** means this PR does not address it. Any production-only evidence remains unverified.

| ID | Finding | State after Phase A | Required next action |
| --- | --- | --- | --- |
| LR-001 | Android `/group-join` not in verified link filters | **Fixed in source** | Play-signed real-device link test |
| LR-002 | Android production `assetlinks.json` absent/404 | **Partial** | Generate using real Play fingerprint; deploy site and verify 200 |
| LR-003 | Android transit / geocoding missing vs iOS | **Partial P0** | Native Google map and Android OS address geocoder added; full JR/private train coverage and real walking provider parity still blocked |
| LR-004 | Group leave alert marked sent before delivery | **Implemented, pending DB CI/release verification** | Transactional per-recipient enqueue and retry; crash-window duplicates possible |
| LR-005 | Google Play background location review missing | **Pending P0** | Consent/declaration, real review footage |
| LR-006 | Concurrent sharing map writes lose active group | **Fixed** | 20-group regression and storage fault tests |
| LR-007 | Concurrent membership map writes lose token | **Fixed** | 20-join regression and storage fault tests |
| LR-008 | Remote group creation can orphan host on crash | **Implemented, pending CI and native-device testing** | Persisted 256-bit creation/host capability; transactional unique-key replay, UI prefill, automatic recovery on app restart |
| LR-009 | Offline reset discards only host token | **Fixed in source** | UI/E2E offline remote-reset test |
| LR-010 | Cross-device/reinstall membership recovery | **Pending** | Authenticated recovery plan and migrations |
| LR-011 | Capability tokens stored in plain AsyncStorage | **Implemented in PR, device QA required** | Native per-token Keychain/Keystore records and hash-only metadata, with crash-retryable legacy migration. Android restore needs rejoin/recovery since Keystore secrets are not portable. Signed-device migration and backup QA remain mandatory |
| LR-012 | Group hosting entitlement relies on client-supplied RevenueCat ID | **Pending P1** | Server-bound identity with verified authorization |
| LR-013 | Container cleanup missing inactive group purge | **Fixed** | Exercise real timed DB cleanup in CI |
| LR-014 | Host inactivity can delete active member groups | **Pending** | Transfer/grace period/explicit notices |
| LR-015 | Push registration only at create/join | **Fixed in source** | Real APNs/FCM token rotation/permission test |
| LR-016 | Group visible screen can remain stale after silent push lost | **Partial** | Focus refresh + manual pull-to-refresh added; continuously visible screens still require push or manual action |
| LR-017 | No-home-device group push tap blocked | **Fixed** | Navigation regression tests |
| LR-018 | Group invite join limit 20/min per IP hits shared Wi-Fi | **Pending** | Token aware rate limit and realistic load test |
| LR-019 | Proxy hop setup can attribute wrong IP | **Implemented in PR, ingress QA required** | Explicit validated TRUST_PROXY_CIDRS instead of unsafe numeric production hops; XFF spoof tests. Actual ingress IP ranges must be verified in staging |
| LR-020 | Stale group membership cleanup on client | **Partial** | Invalidation guard prevents stale 404; test reinstall/offline |
| LR-021 | Group language stale after app locale change | **Fixed in source** | Re-registration on locale switch |
| LR-022 | Stale group GET overwrites newer local mutation | **Fixed in source** | Revision/ordering regression tests |
| LR-023 | Stale invite shown after rotation when push lost | **Pending** | UI invalidate/refresh after foreground |
| LR-024 | Host-transfer error promises unavailable transfer | **Pending** | Implement transfer or remove misleading error |
| LR-025 | Duplicate group member on multiple personal devices | **Pending** | Identity/recovery plan |
| LR-026 | iPhone-only copy appears on Android | **Partial** | Reset screen neutralized; full locale audit |
| LR-027 | Group invite landing page shows only App Store | **Partial** | Platform-aware links implemented; publish only after verified App Store / Play / Galaxy listings are live |
| LR-028 | Generic group API error messages | **Pending** | Localized actionable error states |
| LR-029 | Scheduling error suppressed; fallback misses alerts | **Partial P1** | Backup EventBridge scan every 5 min instead of 30 (alert grace 10 min); Business worker failure no longer prevents re-arming group Scheduler. Signed device delivery, AWS schedule failure alarms and Neon CU cost validation still pending |
| LR-030 | Concurrent EventBridge due writers race | **Implemented, pending CI** | Serialize read/modify/write with transaction-scoped PostgreSQL advisory lock and same-client lookups |
| LR-031 | Group Expo push receipts unreconciled | **Partial** | Minimal opaque receipt-only journal (2h TTL; token SHA-256, no trip/leave time/raw push token) survives 08:05 night purge; 15m all-day receipt checks, backfill of in-flight tickets, safe token rotation. Retention/privacy approval and real APNs/FCM receipt QA still required |
| LR-032 | Motionless background task not guaranteed by OS | **Pending** | Local alarms and foreground recovery |
| LR-033 | One destination request failure discards good routes | **Fixed in source** | Provider failure chaos/integration test |
| LR-034 | Shared-IP route lookups exhaust limiter | **Pending** | Per-client budget and multicaller simulations |
| LR-035 | Straight-line walking ignores geography/barriers | **Partial P0** | Server `/walk` and ODPT nearby return explicit `estimated` provenance; iOS MapKit returns `routed` only for valid native ETAs. Plans propagate provenance, recommend leaving 3–15 min earlier for unverified walks, label times as estimates and link to walking directions; saved legacy plans fail conservative. Actual pedestrian routing, barriers, accessible entrances and measured route corpus remain P0 release blockers |
| LR-036 | iOS vs Android latest train results disagree | **Pending P0** | Provider parity corpus |
| LR-037 | Changes under 60 sec not re-sent | **Decision pending** | Product spec + threshold tests |
| LR-038 | Offline background leave change may never retry | **Partial** | Durable outbox/replay now pins each queued update to server-owned per-participant CAS revision; stale arrivals rejected, newer server state refreshed. Pending migration + signed-device cross-runtime/offline QA; OS cannot guarantee background wakeup |
| LR-039 | OS clears reminder but cached signature remains | **Partial** | Native schedule receipts reconciled; non-cancellable reminder schedule queue now remains serialized after 20s watchdog to prevent older work overwriting newer plans. Physical-device delivery, Focus/AlarmKit recovery and native-hang QA remain pending |
| LR-040 | Android selected notification tone fallback | **Pending** | Channel/tone parity |
| LR-041 | Doze and Focus delivery OS limits | **Platform limit** | Document realistic guarantees and E2E |
| LR-042 | Revoked Android permission leaves tracking state stale | **Partial — patched in review PR** | Foreground permission revocation now ends stale tracking; background-only revocation downgrades after fresh OS check; watcher registration errors are caught. Signed-device Settings/relaunch transitions remain unverified |
| LR-043 | Same-name stations/location ambiguous | **Pending** | Disambiguation by coordinates/operator/prefecture |
| LR-044 | Disruption feed failure appears as no incidents | **Pending** | Health/missing-data UI state |
| LR-045 | Timetable snapshot age not enforced | **Partial** | Deployment preflight plus runtime request-time expiry now reject stale or future-dated cached snapshots; licensed provider coverage, freshness SLO and live disruption checks still pending |
| LR-046 | Midnight/GPS/transfer journey edge cases | **Pending** | Scenario corpus with real data |
| LR-047 | Coordinates/invites in API parse exception message | **Partial** | URL query scrubbed in message and URL; audit remaining fields |
| LR-048 | CI missing real credential/live deploy verification | **Partial** | Build flag gates added; real signed/device preflight missing |
| LR-049 | RevenueCat anonymous cross-platform IDs | **Partial** | 256-bit SecureStore proof enforced for paid group creation; upgrade now attempts verified RevenueCat anonymous logIn and persists crash-recovery receipts, prompting Restore if premium drops. Real store migration/alias QA, app-version adoption/account recovery and cross-platform portability still block release; production deploy now SHA-gated on QA/compatibility approvals |
| LR-050 | Hosting after Premium expiry | **Policy decision** | Choose lifecycle entitlement policy |
| LR-051 | Native/OTA version compatibility and rollback | **Pending** | EAS staged rollback drill |
| LR-052 | Group delivery metrics/ledger absent | **Partial** | Durable ledger implemented; add aggregate alerts/metrics/dashboard and SLO |
| LR-053 | Old mobile binary vs new backend version skew | **Partial** | Legacy leave updates remain possible only while participant revision is zero; after the first versioned update, old clients receive 412 and cannot overwrite the newer value. Stage database-first rollout, test old binaries and minimum-version UX before deploy |
| LR-054 | Lost response creates duplicate group/membership | **Partial, pending CI** | Both group-create and group-join now use persistent 256-bit client operation/member keys; verify signed-device crash recovery and remaining mutations |
| LR-055 | No two-device group/notification CI E2E | **Pending** | Real TestFlight/Play testing matrix |
| LR-056 | Android premium home widget absent | **Pending** | Jetpack Compose native widget or feature disclosure |
| LR-057 | Large accessibility groups, Unicode, offline stress | **Pending** | Device matrix and accessibility QA |
| LR-058 | Release docs cover only business invite links | **Fixed in docs** | Signed routes and both tokens verification |

## Acceptance
Production shipping is **blocked** as long as any P0 release gate above remains pending, irrespective of green unit tests. The underlying source audit carries full explanations; this ledger is an execution tracker, not a replacement for full reproduction instructions.
