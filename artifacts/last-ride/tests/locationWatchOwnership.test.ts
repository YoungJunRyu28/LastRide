import { describe, expect, it, vi } from 'vitest';
import { releaseOwnedWatch } from '@/lib/locationWatchOwnership';

describe('overlapping night-tracking starts', () => {
  it('never removes the newer native watcher when an old operation finishes last', () => {
    const old = { remove: vi.fn() };
    const current = { remove: vi.fn() };
    const slot = { current: old };
    slot.current = current;
    expect(releaseOwnedWatch(slot, old)).toBe(false);
    expect(current.remove).not.toHaveBeenCalled();
    expect(old.remove).not.toHaveBeenCalled();
    expect(slot.current).toBe(current);
  });

  it('removes only the watcher owned by the stale operation when it is still installed', () => {
    const old = { remove: vi.fn() };
    const slot = { current: old };
    expect(releaseOwnedWatch(slot, old)).toBe(true);
    expect(old.remove).toHaveBeenCalledOnce();
    expect(slot.current).toBeNull();
  });
});
