import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  permit: vi.fn(),
  watch: vi.fn(),
}));
vi.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: mocks.permit,
  watchPositionAsync: mocks.watch,
}));
import { beginForegroundLocationWatch } from '@/lib/foregroundLocationWatch';

describe('foreground location subscription', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.permit.mockResolvedValue({ granted: true });
    mocks.watch.mockResolvedValue({ remove: vi.fn() });
  });

  it('starts a watch with conservative intervals when permission is granted', async () => {
    const onPosition = vi.fn();
    const result = await beginForegroundLocationWatch(onPosition);
    expect(result.status).toBe('started');
    expect(mocks.watch).toHaveBeenCalledWith({
      accuracy: 3, distanceInterval: 150, timeInterval: 120000,
    }, onPosition);
  });

  it('does not watch if the user declined foreground access', async () => {
    mocks.permit.mockResolvedValue({ granted: false });
    expect(await beginForegroundLocationWatch(vi.fn())).toEqual({ status: 'denied' });
    expect(mocks.watch).not.toHaveBeenCalled();
  });

  it('handles an OS permission prompt that throws instead of rejecting UI handlers', async () => {
    mocks.permit.mockRejectedValue(new Error('OS location services unavailable'));
    expect(await beginForegroundLocationWatch(vi.fn())).toEqual({ status: 'unavailable' });
  });

  it('handles Android permission revocation after the grant and before registration', async () => {
    mocks.watch.mockRejectedValue(new Error('Location access revoked'));
    expect(await beginForegroundLocationWatch(vi.fn())).toEqual({ status: 'unavailable' });
  });
});
