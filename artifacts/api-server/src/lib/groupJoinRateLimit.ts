import { createHash } from "node:crypto";

/**
 * One shared Wi-Fi address may have dozens of genuine group attendees.
 * A persistent 256-bit join-operation key distinguishes their anonymous
 * retry attempts without storing a raw invite or member credential.
 *
 * This is not authentication: attackers can generate many operation keys.
 * The separate total-IP guard must always be applied as well.
 */
export function groupJoinAttemptRateKey(address: string, joinKey: string | undefined): string {
  if (joinKey && /^[a-f0-9]{64}$/i.test(joinKey)) {
    const digest = createHash("sha256").update(joinKey.toLowerCase()).digest("hex");
    return `groups-join-attempt:${address}:${digest}`;
  }
  // Legacy clients without an idempotent join key preserve the original
  // 20/min shared-IP rate limit. Garbage headers may not bypass it.
  return `groups-join-legacy:${address}`;
}
export const GROUP_JOIN_IP_LIMIT = 120;
export const GROUP_JOIN_ATTEMPT_LIMIT = 20;
