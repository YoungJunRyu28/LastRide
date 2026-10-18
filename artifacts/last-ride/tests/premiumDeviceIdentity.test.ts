import { beforeEach, describe, expect, it, vi } from 'vitest';

const { storage, entropy } = vi.hoisted(() => ({
  storage: { secret: null as string | null, available: true, failWrite: false },
  entropy: vi.fn(async (length: number) => Uint8Array.from({ length }, (_, index) => index)),
}));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK: 'AFTER_FIRST_UNLOCK',
  isAvailableAsync: vi.fn(async () => storage.available),
  getItemAsync: vi.fn(async () => storage.secret),
  setItemAsync: vi.fn(async (_key: string, value: string) => {
    if (storage.failWrite) throw new Error('Keychain write failed');
    storage.secret = value;
  }),
}));
vi.mock('expo-crypto', async () => {
  const { createHash } = await import('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    getRandomBytesAsync: entropy,
    digestStringAsync: vi.fn(async (_algorithm: string, text: string) =>
      createHash('sha256').update(text, 'utf8').digest('hex')),
  };
});

beforeEach(() => {
  vi.resetModules();
  storage.secret = null;
  storage.available = true;
  storage.failWrite = false;
  entropy.mockClear();
});

describe('RevenueCat OS-secured device identity', () => {
  it('creates one 256-bit identity across parallel purchase/group calls', async () => {
    const { getOrCreatePremiumDeviceIdentity } = await import('@/lib/premiumDeviceIdentity');
    const identities = await Promise.all(Array.from({ length: 20 }, getOrCreatePremiumDeviceIdentity));
    expect(new Set(identities.map(value => value.appUserId)).size).toBe(1);
    expect(entropy).toHaveBeenCalledTimes(1);
    expect(storage.secret).toMatch(/^[a-f0-9]{64}$/);
    const { createHash } = await import('node:crypto');
    expect(identities[0].appUserId).toBe('lr_' + createHash('sha256')
      .update('lastride-premium-v1:' + storage.secret).digest('hex'));
  });
  it('uses the original Keychain identity on restart and never silently rekeys purchases', async () => {
    const { getOrCreatePremiumDeviceIdentity } = await import('@/lib/premiumDeviceIdentity');
    const old = await getOrCreatePremiumDeviceIdentity();
    vi.resetModules();
    const restarted = await import('@/lib/premiumDeviceIdentity');
    expect(await restarted.getOrCreatePremiumDeviceIdentity()).toEqual(old);
    expect(entropy).toHaveBeenCalledTimes(1);
  });
  it('fails closed when native secure storage is inaccessible', async () => {
    storage.available = false;
    const { getOrCreatePremiumDeviceIdentity } = await import('@/lib/premiumDeviceIdentity');
    await expect(getOrCreatePremiumDeviceIdentity()).rejects.toThrow('Secure device storage');
    expect(entropy).not.toHaveBeenCalled();
  });
  it('rejects corruption instead of overwriting the entitlement identity', async () => {
    storage.secret = 'short-or-corrupt';
    const { getOrCreatePremiumDeviceIdentity } = await import('@/lib/premiumDeviceIdentity');
    await expect(getOrCreatePremiumDeviceIdentity()).rejects.toThrow('Saved premium identity is invalid');
    expect(storage.secret).toBe('short-or-corrupt');
    expect(entropy).not.toHaveBeenCalled();
  });
  it('never returns an unpersisted identity if Keychain write fails', async () => {
    storage.failWrite = true;
    const { getOrCreatePremiumDeviceIdentity } = await import('@/lib/premiumDeviceIdentity');
    await expect(getOrCreatePremiumDeviceIdentity()).rejects.toThrow('Keychain write failed');
    expect(storage.secret).toBeNull();
  });
});
