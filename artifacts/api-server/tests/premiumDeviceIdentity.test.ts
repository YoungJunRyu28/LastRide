import { afterEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { premiumDeviceProofRequired, revenueCatUserIdForDeviceSecret, verifiedPremiumDeviceIdentity } from '../src/lib/premiumDeviceIdentity';

const NODE_ENV = process.env.NODE_ENV;
const STAGE = process.env.LASTRIDE_STAGE;
afterEach(() => { process.env.NODE_ENV = NODE_ENV; if (STAGE === undefined) delete process.env.LASTRIDE_STAGE; else process.env.LASTRIDE_STAGE = STAGE; });

describe('RevenueCat paid-host identity proof', () => {
  it('accepts only proof of the secret that generated the RevenueCat ID', () => {
    const secret = randomBytes(32).toString('hex');
    const id = revenueCatUserIdForDeviceSecret(secret)!;
    expect(id).toMatch(/^lr_[a-f0-9]{64}$/);
    expect(verifiedPremiumDeviceIdentity(id, secret)).toBe(true);
    expect(verifiedPremiumDeviceIdentity(id, randomBytes(32).toString('hex'))).toBe(false);
  });
  it('refuses a copied paid user ID without the matching secret', () => {
    const secret = randomBytes(32).toString('hex');
    const id = revenueCatUserIdForDeviceSecret(secret)!;
    for (const stolen of [undefined, '', 'other', 'ab'.repeat(31), 'ab'.repeat(33), secret.toUpperCase()]) {
      expect(verifiedPremiumDeviceIdentity(id, stolen)).toBe(false);
    }
    expect(verifiedPremiumDeviceIdentity('somebody-elses-anonymous-id', secret)).toBe(false);
  });
  it('refuses forged, uppercase, malformed or non-256-bit capabilities', () => {
    const secret = randomBytes(32).toString('hex');
    expect(revenueCatUserIdForDeviceSecret(secret.toUpperCase())).toBeNull();
    expect(revenueCatUserIdForDeviceSecret('x'.repeat(64))).toBeNull();
    expect(revenueCatUserIdForDeviceSecret(secret + 'ff')).toBeNull();
    expect(verifiedPremiumDeviceIdentity('lr_' + '0'.repeat(64), secret)).toBe(false);
    expect(verifiedPremiumDeviceIdentity('lr_' + 'x'.repeat(64), secret)).toBe(false);
  });
  it('requires binding in production but supports explicitly identified staging', () => {
    process.env.NODE_ENV = 'production'; delete process.env.LASTRIDE_STAGE;
    expect(premiumDeviceProofRequired()).toBe(true);
    process.env.LASTRIDE_STAGE = 'production';
    expect(premiumDeviceProofRequired()).toBe(true);
    process.env.LASTRIDE_STAGE = 'staging';
    expect(premiumDeviceProofRequired()).toBe(false);
    process.env.NODE_ENV = 'test';
    expect(premiumDeviceProofRequired()).toBe(false);
    delete process.env.NODE_ENV;
    delete process.env.LASTRIDE_STAGE;
    expect(premiumDeviceProofRequired()).toBe(true); // Lambda may omit NODE_ENV
    process.env.LASTRIDE_STAGE = 'production';
    process.env.NODE_ENV = 'test';
    expect(premiumDeviceProofRequired()).toBe(true);
  });
});
