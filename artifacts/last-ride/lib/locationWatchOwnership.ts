/** Avoid removing another session's watcher when an old async start finishes
 * after Stop or a second Start. Only the subscription installed by this
 * operation may be removed by its stale-completion path. */
export function releaseOwnedWatch<T extends { remove: () => void }>(
  slot: { current: T | null },
  watch: T,
): boolean {
  if (slot.current !== watch) return false;
  slot.current = null;
  watch.remove();
  return true;
}
