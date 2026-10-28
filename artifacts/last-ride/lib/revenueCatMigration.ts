/**
 * One-time transition from the old RevenueCat-generated anonymous customer ID
 * to LastRide's proof-of-possession ID. This module is SDK-agnostic, permitting
 * failure-injection tests of crashes, rejected logins and purchase preservation.
 *
 * RevenueCat may alias an anonymous customer on logIn, but it does NOT always
 * merge users, especially if the target already has an anonymous alias. Never
 * assume a successful logIn preserved an active subscription.
 */
export type MigrationStatus = 'complete' | 'pending-entitled' | 'restore-required';
export type MigrationOutcome = { restoreRequired: boolean };

export type IdentityMigrationClient<T> = {
  targetId: string;
  readStatus: () => Promise<MigrationStatus | null>;
  writeStatus: (status: MigrationStatus) => Promise<void>;
  getCurrentId: () => Promise<string>;
  getCustomerInfo: () => Promise<T>;
  logIn: (id: string) => Promise<T>;
  hasPremium: (info: T) => boolean;
};

export async function migrateRevenueCatIdentity<T>(client: IdentityMigrationClient<T>): Promise<MigrationOutcome> {
  const status = await client.readStatus();
  if (status === 'complete' || status === 'restore-required') {
    return { restoreRequired: status === 'restore-required' };
  }
  const currentId = await client.getCurrentId();
  const oldInfo = await client.getCustomerInfo();
  const previouslyPaid = status === 'pending-entitled' || client.hasPremium(oldInfo);

  if (currentId === client.targetId) {
    // Crash recovery after successful logIn but before completion marker.
    const missing = previouslyPaid && !client.hasPremium(oldInfo);
    await client.writeStatus(missing ? 'restore-required' : 'complete');
    return { restoreRequired: missing };
  }

  if (previouslyPaid && status !== 'pending-entitled') {
    // Persist BEFORE switching SDK identity. If the OS terminates us during
    // logIn, the next startup remembers there was a paid entitlement to retain.
    await client.writeStatus('pending-entitled');
  }

  // A prior custom ID won't necessarily alias either. Detect the loss in
  // the same way instead of silently presenting the new identity as unpaid.
  const migrated = await client.logIn(client.targetId);
  if (await client.getCurrentId() !== client.targetId) {
    throw new Error('RevenueCat did not switch to the bound customer identity');
  }
  const missing = previouslyPaid && !client.hasPremium(migrated);
  await client.writeStatus(missing ? 'restore-required' : 'complete');
  return { restoreRequired: missing };
}
