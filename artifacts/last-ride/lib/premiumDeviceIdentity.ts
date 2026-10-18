/**
 * Anonymous-but-proof-of-possession RevenueCat identity. The 256-bit random
 * secret stays in native secure storage; only an SHA-256-derived ID is sent to
 * RevenueCat. The secret is sent ONLY to our HTTPS group-create API to prove
 * ownership of that ID. Copying a RevenueCat customer ID cannot unlock groups.
 *
 * WARNING: Changing an existing RevenueCat anonymous App User ID can require
 * an explicit purchase restore; test subscription transfer/restore behavior in
 * sandbox before shipping this protocol to users with existing purchases.
 */
import { CryptoDigestAlgorithm, digestStringAsync, getRandomBytesAsync } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { MigrationStatus } from '@/lib/revenueCatMigration';

const KEY = 'lastride-premium-device-secret-v1';
const MIGRATION_KEY = 'lastride-premium-revenuecat-migration-v1';
const HEX = /^[0-9a-f]{64}$/;
const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

type PremiumDeviceIdentity = { appUserId: string; secret: string };
let pending: Promise<PremiumDeviceIdentity> | null = null;

async function resolveIdentity(): Promise<PremiumDeviceIdentity> {
  if (Platform.OS === 'web' || !(await SecureStore.isAvailableAsync())) {
    throw new Error('Secure device storage is required for purchases and paid group hosting.');
  }
  let secret = await SecureStore.getItemAsync(KEY, KEYCHAIN_OPTIONS);
  if (secret !== null && !HEX.test(secret)) {
    // Fail closed rather than replacing a capability potentially tied to
    // paid receipts, which could strand purchases or existing memberships.
    throw new Error('Saved premium identity is invalid; recover the existing identity before continuing.');
  }
  if (secret === null) {
    const random = await getRandomBytesAsync(32);
    secret = Array.from(random, byte => byte.toString(16).padStart(2, '0')).join('');
    if (!HEX.test(secret)) throw new Error('Could not generate secure purchase identity.');
    await SecureStore.setItemAsync(KEY, secret, KEYCHAIN_OPTIONS);
  }
  const digest = await digestStringAsync(CryptoDigestAlgorithm.SHA256, 'lastride-premium-v1:' + secret);
  if (!HEX.test(digest)) throw new Error('Invalid premium identity digest.');
  return { appUserId: 'lr_' + digest, secret };
}

/** Share the single in-flight Keychain generation across concurrent React
 * renders, subscription initialization and group create retries. */
export function getOrCreatePremiumDeviceIdentity(): Promise<PremiumDeviceIdentity> {
  if (!pending) {
    pending = resolveIdentity().catch(error => { pending = null; throw error; });
  }
  return pending;
}

/** Migration receipts live next to the identity secret in native secure storage.
 * Never mark an interrupted purchase migration complete based solely on
 * successful SDK configuration. */
export async function readPremiumMigrationStatus(): Promise<MigrationStatus | null> {
  if (Platform.OS === 'web' || !(await SecureStore.isAvailableAsync())) {
    throw new Error('Secure storage is required for purchase migration.');
  }
  const status = await SecureStore.getItemAsync(MIGRATION_KEY, KEYCHAIN_OPTIONS);
  if (status === null) return null;
  if (status === 'complete' || status === 'pending-entitled' || status === 'restore-required') return status;
  throw new Error('Corrupted purchase-migration state; do not silently replace it.');
}

export async function writePremiumMigrationStatus(status: MigrationStatus): Promise<void> {
  if (Platform.OS === 'web' || !(await SecureStore.isAvailableAsync())) {
    throw new Error('Secure storage is required for purchase migration.');
  }
  await SecureStore.setItemAsync(MIGRATION_KEY, status, KEYCHAIN_OPTIONS);
}
