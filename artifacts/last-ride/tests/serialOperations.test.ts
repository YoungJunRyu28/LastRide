import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSerialOperations } from '@/lib/serialOperations';

afterEach(() => {
  vi.useRealTimers();
});

describe('non-cancellable reminder operations', () => {
  it('does not warn after work has already completed', async () => {
    vi.useFakeTimers();
    const warning = vi.fn();
    const enqueue = createSerialOperations(20_000, warning);
    await enqueue(async () => undefined);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(warning).not.toHaveBeenCalled();
  });

  it('does not allow a timed-out old operation to race and overwrite the newer schedule', async () => {
    vi.useFakeTimers();
    const warning = vi.fn();
    const enqueue = createSerialOperations(20_000, warning);
    const events: string[] = [];
    let unblock!: () => void;
    const pending = new Promise<void>((resolve) => { unblock = resolve; });
    const old = enqueue(async () => {
      events.push('old-start');
      await pending;
      events.push('old-end');
    });
    const newer = enqueue(async () => {
      events.push('new-start');
    });
    await vi.advanceTimersByTimeAsync(20_001);
    expect(warning).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['old-start']); // New work cannot start at the timeout.
    unblock();
    await Promise.all([old, newer]);
    expect(events).toEqual(['old-start', 'old-end', 'new-start']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears a failed operation watchdog and continues to the next operation', async () => {
    vi.useFakeTimers();
    const warning = vi.fn();
    const enqueue = createSerialOperations(20_000, warning);
    const seen: string[] = [];
    await expect(enqueue(async () => { throw new Error('native failure'); }))
      .rejects.toThrow('native failure');
    await enqueue(async () => { seen.push('recovered'); });
    expect(seen).toEqual(['recovered']);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(warning).not.toHaveBeenCalled();
  });

  it('always serializes concurrent submissions with asynchronous native work', async () => {
    const enqueue = createSerialOperations(60_000, vi.fn());
    let active = 0;
    let peak = 0;
    await Promise.all(Array.from({ length: 25 }, () => enqueue(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
    })));
    expect(peak).toBe(1);
  });
});
