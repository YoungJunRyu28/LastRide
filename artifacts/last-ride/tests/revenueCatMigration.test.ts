import { describe, expect, it, vi } from 'vitest';
import { migrateRevenueCatIdentity, type MigrationStatus } from '@/lib/revenueCatMigration';

function setup(options: { initialId?: string; oldPaid?: boolean; migratedPaid?: boolean; initialStatus?: MigrationStatus | null } = {}) {
  let status = options.initialStatus ?? null;
  let current = options.initialId ?? '$RCAnonymousID:legacy';
  let active = options.oldPaid ?? false;
  const logIn = vi.fn(async (id: string) => {
    current = id;
    active = options.migratedPaid ?? options.oldPaid ?? false;
    return { active };
  });
  const writeStatus = vi.fn(async (next: MigrationStatus) => { status = next; });
  const client = {
    targetId: 'lr_' + 'a'.repeat(64),
    readStatus: async () => status,
    writeStatus,
    getCurrentId: async () => current,
    getCustomerInfo: async () => ({ active }),
    logIn,
    hasPremium: (info: { active: boolean }) => info.active,
  };
  return { client, logIn, writeStatus, getStatus: () => status };
}

describe('anonymous RevenueCat purchase migration', () => {
  it('aliases an unpaid anonymous identity to the secure customer once', async () => {
    const { client, logIn, getStatus } = setup();
    expect(await migrateRevenueCatIdentity(client)).toEqual({ restoreRequired: false });
    expect(logIn).toHaveBeenCalledWith(client.targetId);
    expect(getStatus()).toBe('complete');
    await migrateRevenueCatIdentity(client);
    expect(logIn).toHaveBeenCalledTimes(1);
  });
  it('preserves a paid customer and records complete only AFTER logIn verified premium', async () => {
    const { client, writeStatus } = setup({ oldPaid: true, migratedPaid: true });
    expect(await migrateRevenueCatIdentity(client)).toEqual({ restoreRequired: false });
    expect(writeStatus.mock.calls.map(([status]) => status)).toEqual(['pending-entitled', 'complete']);
  });
  it('does not silently drop a paid subscription if RevenueCat refuses to merge', async () => {
    const { client, getStatus } = setup({ oldPaid: true, migratedPaid: false });
    expect(await migrateRevenueCatIdentity(client)).toEqual({ restoreRequired: true });
    expect(getStatus()).toBe('restore-required');
  });
  it('recovers after a process crash between receipt check and RevenueCat login', async () => {
    const { client, writeStatus, logIn, getStatus } = setup({oldPaid:true, migratedPaid:true});
    logIn.mockRejectedValueOnce(new Error('network outage'));
    await expect(migrateRevenueCatIdentity(client)).rejects.toThrow('network outage');
    expect(getStatus()).toBe('pending-entitled');
    expect(await migrateRevenueCatIdentity(client)).toEqual({restoreRequired:false});
    expect(writeStatus).toHaveBeenCalledWith('complete');
  });
  it('preserves restore-required marker across restarts rather than allowing a new purchase silently', async () => {
    const { client, logIn } = setup({initialStatus:'restore-required'});
    expect(await migrateRevenueCatIdentity(client)).toEqual({restoreRequired:true});
    expect(logIn).not.toHaveBeenCalled();
  });
  it('recovers an interrupted successful login where the SDK is already on the target ID', async () => {
    const { client, logIn, getStatus } = setup({ initialId: 'lr_'+'a'.repeat(64), oldPaid:true, initialStatus:'pending-entitled' });
    expect(await migrateRevenueCatIdentity(client)).toEqual({restoreRequired:false});
    expect(getStatus()).toBe('complete');
    expect(logIn).not.toHaveBeenCalled();
  });
  it('detects an interrupted login that landed on target but lost entitlement', async () => {
    const {client,getStatus} = setup({ initialId:'lr_'+'a'.repeat(64),oldPaid:false,initialStatus:'pending-entitled'});
    expect(await migrateRevenueCatIdentity(client)).toEqual({restoreRequired:true});
    expect(getStatus()).toBe('restore-required');
  });
  it('never assumes an older identified customer gets an automatic entitlement transfer', async () => {
    const {client,getStatus} = setup({initialId:'legacy-user-id',oldPaid:true,migratedPaid:false});
    expect(await migrateRevenueCatIdentity(client)).toEqual({restoreRequired:true});
    expect(getStatus()).toBe('restore-required');
  });
  it('refuses to switch a paying customer when the Keychain pending marker cannot be saved', async () => {
    const {client,logIn} = setup({oldPaid:true});
    client.writeStatus.mockImplementation(async () => {throw new Error('Keychain full');});
    await expect(migrateRevenueCatIdentity(client)).rejects.toThrow('Keychain full');
    expect(logIn).not.toHaveBeenCalled();
  });
  it('does not overwrite a completed identity migration after app relaunch', async () => {
    const {client,logIn,writeStatus} = setup({initialStatus:'complete',initialId:'$RCAnonymousID:old'});
    expect(await migrateRevenueCatIdentity(client)).toEqual({restoreRequired:false});
    expect(logIn).not.toHaveBeenCalled();
    expect(writeStatus).not.toHaveBeenCalled();
  });
  it('fails without marking success if the SDK does not actually switch identities', async () => {
    const {client,writeStatus} = setup();
    client.logIn = vi.fn(async (_id: string) => ({ active: false }));
    await expect(migrateRevenueCatIdentity(client)).rejects.toThrow('did not switch');
    expect(writeStatus).not.toHaveBeenCalledWith('complete');
  });
});
