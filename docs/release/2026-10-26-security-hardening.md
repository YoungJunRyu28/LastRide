# October 26, 2026 — production security follow-up

## Native group capability vault (LR-011)

The old lastride-group-memberships AsyncStorage list included raw member
capability tokens. Native iOS and Android now use OS-backed secure storage
(Keychain/Keystore) for each token. Ordinary app storage contains group IDs,
display names and irreversible SHA-256 token references only.

Migration: validate the old data, write every token into secure storage,
commit the index, verify all secure entries, and only then delete plaintext.
A crash/failure preserves legacy credentials for retry. Replacing a token
uses an immutable new secure key, so a failed index update preserves the old
usable token. Missing secure credentials fail closed; native clients do not
silently downgrade to AsyncStorage.

Web remains on AsyncStorage (no native Keychain); browser secrets are not
protected by this change.

Android backup/restore can recover an index without its Keystore entries.
Rejoining/recovery may be required; authenticated cross-device recovery is
not implemented. Test app update, reinstall, backup/restore, Keychain/Keystore
errors and long-running background tasks on actual signed devices. iOS
Keychain portability varies with entitlements and device restore policy.

## Strict proxy boundaries (LR-019)

Production requests can trust forwarded IP headers only from explicit
TRUST_PROXY_CIDRS source networks; numeric positive TRUST_PROXY_HOPS without
a CIDR allowlist is rejected. The default trusts no forwarding headers.
Wildcard, malformed and too-broad ranges are rejected.

Deployment must establish the actual ingress/load-balancer socket addresses.
Do not guess trust ranges; an incorrect range can group users under the
proxy IP or cause unintended rate limiting. Staging spoof tests are required.

## Remaining gates

Full CI must pass. Signed device migration and backup QA, production transit
licensing/coverage, pedestrian route data, RevenueCat legacy migration and
store billing, real APNs/AlarmKit/FCM, and release approvals remain.
No deployment, database migration or store submission performed.

## October 26 follow-up: confirmed reset and rename defects

The first secure-store implementation could delete some keys during Reset &
start over, then crash or fail to remove AsyncStorage metadata. The next launch
would see a corrupt-looking group list with missing secrets and refuse all
writes. Reset now records a nonsecret durable reset marker **before** deleting
any keys. It completes pending reset first on next access, and removes the
marker only after all keys and metadata are cleared. Interrupted secure
deletions, partially failed storage batches, and failed marker writes now have
regression tests.

The Groups provider also previously updated a cached group name optimistically
and ignored a rejected secure-store write, leading to an unhandled promise
rejection. It now persists the rename first and updates local cached metadata
only after the write succeeds, without replacing the membership token.

These checks do not establish device restore safety until signed iOS/Android
upgrade and reinstall exercises pass. There is no authenticated account
recovery for a genuinely lost Keystore credential.

One more post-commit defect was confirmed: removing a group could commit a
new index and then fail to delete the now-obsolete secure token. This used to
reject the operation despite the index already being updated and leave an
orphaned Keychain entry. A durable nonsecret retirement journal now records
tokens scheduled for cleanup before committing the index. After commit,
cleanup is best-effort and retried on later reads; interrupted index writes
cannot delete credentials still referenced by the saved group list. Reset
also clears pending retirements. Regression tests cover both failure orders.


After Android restore, a missing Keystore token previously blocked *all* new
joins because group join obtains the existing member-token list first. The
Groups tab now offers a separate, destructive, explicitly confirmed local
recovery action for this scenario. It keeps retry as the primary option,
does not pretend to delete server-side groups, preserves unresolved join/create
proofs by rejecting recovery while either is pending, and explains that the
user may need a new invitation. It is not automatic credential recovery.
