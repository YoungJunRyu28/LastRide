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
