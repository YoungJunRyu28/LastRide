/** Keep OS notification schedules in sync with the persisted LastRide ledger.
 * A cached signature alone is not proof that iOS/Android still has alerts. */
export type ScheduledLocalNotification = { id: string; fireAt: number };

export function isNativeReminderScheduleIntact(
  expectedFutureCount: number,
  persisted: ScheduledLocalNotification[],
  nativeIds: ReadonlySet<string>,
  now: number,
): boolean {
  if (!Number.isSafeInteger(expectedFutureCount) || expectedFutureCount < 0) return false;
  if (expectedFutureCount === 0) return true;
  // Allow overdue ones to disappear from the native schedule. If the planner
  // still expects them ahead of us, recompute without trusting the signature.
  const future = persisted.filter((entry) =>
    entry && typeof entry.id === 'string' && entry.id.length > 0 &&
    Number.isFinite(entry.fireAt) && entry.fireAt > now + 1000);
  return future.length === expectedFutureCount &&
    new Set(future.map((entry) => entry.id)).size === future.length &&
    future.every((entry) => nativeIds.has(entry.id));
}
