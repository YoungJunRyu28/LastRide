/**
 * Serializes non-cancellable native operations.
 *
 * A Promise.race timeout must not release the next operation while the
 * previous one is still running: the timed-out operation can wake later and
 * cancel or overwrite reminders that were scheduled by its successor.
 *
 * A watchdog logs a slow operation but only the actual settlement releases
 * the queue. The watchdog is cleared on success/failure so it never reports
 * completed work as stuck.
 */
export function createSerialOperations(
  warnAfterMs: number,
  warn: () => void,
): (operation: () => Promise<void>) => Promise<void> {
  let tail: Promise<void> = Promise.resolve();
  return (operation) => {
    const run = async () => {
      const watchdog = setTimeout(warn, warnAfterMs);
      try {
        await operation();
      } finally {
        clearTimeout(watchdog);
      }
    };
    const current = tail.then(run, run);
    // Even a rejected task must not poison later queue entries.
    tail = current.then(() => undefined, () => undefined);
    return current;
  };
}
