# October 27 group recovery and invitation fixes

This follow-up to draft PR #48 fixes four concrete issues:

1. A restored Android group index with missing Keystore secrets caused a
   join to persist a *new* pending operation before discovering that it could
   not read existing group credentials. The false pending operation then
   blocked the "Forget inaccessible groups" recovery UI. Existing capabilities
   must be read successfully before a new pending join is persisted.
   Regression coverage confirms a failed read creates no join proof, and
   recovery can start a fresh, idempotent join.
2. The Groups provider could propagate a Keychain cleanup failure from a
   background group refresh or 404 handler. Cleanup failures now surface the
   credential recovery state without rejecting an unobserved push/AppState
   callback or leaving the initial loading spinner active. An OS push-token
   lookup failure is retried later, not interpreted as a revoked token.
3. Someone else can rotate a group invite while an open details screen still
   displays its prior token. The Share Invite action now retrieves the
   current server group and builds the share text only from that response;
   offline or missing invites do not open the native share sheet. Tests
   cover stale cached links, fetch failure, absent invites and asynchronous
   ordering. This does not guarantee the invite cannot rotate again after
   the fetch and before delivery.
4. A group of 50 legitimate attendees sharing one venue/campus IP could
   exceed the old 20-join/minute single-IP limiter. Modern clients already
   carry a persistent, random, 256-bit join-operation key. Rate limiting now
   gives each operation a 20/min retry budget, while a separate 120/min shared
   IP ceiling limits misuse of arbitrary generated keys. Legacy clients
   lacking valid keys keep the original 20/min shared-IP budget. The keys are
   digested and never persisted raw in rate-limit rows. Unit checks cover 50
   attendees, same-operation flooding, legacy clients, and the total-IP cap.
   Production abuse/load monitoring and real campus NAT load testing remain
   necessary.

The HTTP host-self-remove error no longer promises unsupported host role
transfer; the only supported host departure path is disbanding the group.

During the final pass, local departure cleanup was also reordered so that
the durable background leave-time outbox is cleared before deleting the
membership credential. A failed outbox write now leaves the group credential
available for retry rather than leaving pending sends without a usable token.

Deployment and store release remain gated on signed-device tests, real
transit coverage, location/notification OS behavior and purchase restore.
