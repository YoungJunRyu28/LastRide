/** Bind an anonymous RevenueCat customer to possession of a separate, 256-bit
 * device capability. A copied RevenueCat App User ID alone is not authority.
 * The preimage is stored in iOS Keychain / Android Keystore by the mobile app,
 * never persisted in the server DB. HTTPS is mandatory for a production API.
 * This is device-bound, NOT account authentication or cross-device recovery.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

const SECRET_HEX = /^[a-f0-9]{64}$/;
const USER_ID = /^lr_[a-f0-9]{64}$/;

export function revenueCatUserIdForDeviceSecret(secret: string): string | null {
  if (!SECRET_HEX.test(secret)) return null;
  return `lr_${createHash('sha256').update('lastride-premium-v1:' + secret, 'utf8').digest('hex')}`;
}

/** Strict in deployed production; development and staging can still test
 * existing anonymous customer IDs against local fake RevenueCat responses. */
export function premiumDeviceProofRequired(): boolean {
  // Lambda may not set NODE_ENV. Unspecified mode is production-safe: only
  // explicit tests/development or the staging stack can bypass this gate.
  if (process.env.LASTRIDE_STAGE === 'production') return true;
  if (process.env.LASTRIDE_STAGE === 'staging') return false;
  return process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'development';
}

export function verifiedPremiumDeviceIdentity(appUserId: string, secret: string | undefined): boolean {
  if (!USER_ID.test(appUserId) || !secret) return false;
  const derived = revenueCatUserIdForDeviceSecret(secret);
  if (!derived) return false;
  // Avoid shortcut branches based on matching hash bytes.
  return timingSafeEqual(Buffer.from(derived, 'ascii'), Buffer.from(appUserId, 'ascii'));
}
