/**
 * Never share a previously rendered group invite without a fresh server read.
 * The host or another member may have rotated it while this view was open.
 *
 * The fetch must complete before any share sheet is displayed; a network
 * outage is not proof that the previously cached token still works.
 */
export async function shareLatestGroupInvite<T>(
  fetchCurrent: () => Promise<T>,
  format: (group: T) => string | null,
  applyCurrent: (group: T) => void,
  share: (message: string) => Promise<void>,
): Promise<boolean> {
  const current = await fetchCurrent();
  applyCurrent(current);
  const message = format(current);
  if (message === null) return false;
  await share(message);
  return true;
}
