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
