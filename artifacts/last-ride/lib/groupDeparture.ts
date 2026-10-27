/**
 * The server can remove a membership before local SecureStore deletion
 * completes. Never navigate away or report departure success while the local
 * capability still exists on the device.
 */
export async function completeGroupDeparture(
  leaveServer: () => Promise<void>,
  forgetDevice: () => Promise<void>,
  navigateAway: () => void,
): Promise<void> {
  await leaveServer();
  await forgetDevice();
  navigateAway();
}

/**
 * Do not delete the capability needed to retry an outstanding leave-time
 * update until its durable sharing outbox is cleared.
 */
export async function forgetGroupLocalAccess(
  stopPendingShares: () => Promise<void>,
  removeCredential: () => Promise<void>,
): Promise<void> {
  await stopPendingShares();
  await removeCredential();
}
