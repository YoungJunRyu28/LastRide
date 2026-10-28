import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enterpriseAlerts: vi.fn(), groupAlerts: vi.fn(), next: vi.fn(),
  enterpriseReceipts: vi.fn(), groupReceipts: vi.fn(),
  cleanup: vi.fn(), warnings: vi.fn(), info: vi.fn(), watchdogRunning: vi.fn(),
}));
vi.mock('@workspace/db', () => ({ isDatabaseConfigured: () => true }));
vi.mock('../src/lib/enterpriseNotifications', () => ({
  dispatchEnterpriseDepartureAlerts: mocks.enterpriseAlerts,
  reconcileEnterprisePushReceipts: mocks.enterpriseReceipts,
}));
vi.mock('../src/lib/groupNotifications', () => ({ dispatchGroupLeaveAlerts: mocks.groupAlerts }));
vi.mock('../src/lib/groupAlertOutbox', () => ({ reconcileGroupPushReceipts: mocks.groupReceipts }));
vi.mock('../src/lib/leaveAlertSchedule', () => ({ scheduleNextLeaveAlert: mocks.next, watchdogRunning: mocks.watchdogRunning }));
vi.mock('../src/lib/cache', () => ({ purgeExpiredCacheEntries: mocks.cleanup }));
vi.mock('../src/lib/rateLimit', () => ({ purgeExpiredRateLimits: mocks.cleanup }));
vi.mock('../src/lib/enterpriseStore', () => ({ purgeExpiredEnterpriseData: mocks.cleanup }));
vi.mock('../src/lib/groupStore', () => ({ purgeEndedGroupNights: mocks.cleanup, purgeInactiveGroupMembers: mocks.cleanup }));
vi.mock('../src/lib/logger', () => ({ logger: { warn: mocks.warnings, info: mocks.info } }));
import { handler } from '../src/scheduled';

beforeEach(() => {
  Object.values(mocks).forEach(mock => mock.mockReset());
  mocks.enterpriseAlerts.mockResolvedValue(0);
  mocks.groupAlerts.mockResolvedValue(0);
  mocks.enterpriseReceipts.mockResolvedValue({ checked: 0, invalidDevices: 0 });
  mocks.groupReceipts.mockResolvedValue({ checked: 0, invalidDevices: 0 });
  mocks.next.mockResolvedValue(undefined);
  mocks.watchdogRunning.mockResolvedValue(false);
});

describe('scheduled group-alert failover', () => {
  it('rearms the next group alert after a successful dispatch', async () => {
    mocks.groupAlerts.mockResolvedValue(2);
    await handler({ task: 'departureAlerts' });
    expect(mocks.next).toHaveBeenCalledExactlyOnceWith({ onlyEarlier: false, rethrow: true });
    expect(mocks.info).toHaveBeenCalledWith({ groupLeaveAlerts: 2 }, 'Sent group leave-time alerts');
  });

  it('rearms the group schedule even when independent enterprise processing crashes', async () => {
    const failure = new Error('Business provider outage');
    mocks.enterpriseAlerts.mockRejectedValue(failure);
    mocks.groupAlerts.mockResolvedValue(3);
    await expect(handler({ task: 'departureAlerts' })).rejects.toBe(failure);
    expect(mocks.groupAlerts).toHaveBeenCalledOnce();
    expect(mocks.next).toHaveBeenCalledExactlyOnceWith({ onlyEarlier: false, rethrow: true });
  });

  it('rearms after group dispatch failure so EventBridge can retry pending alerts', async () => {
    const failure = new Error('Transient Postgres failure');
    mocks.groupAlerts.mockRejectedValue(failure);
    await expect(handler({ task: 'departureAlerts' })).rejects.toBe(failure);
    expect(mocks.next).toHaveBeenCalledExactlyOnceWith({ onlyEarlier: false, rethrow: true });
  });

  it('checks group Expo receipts even when enterprise receipt reconciliation fails', async () => {
    const failure = new Error('Business receipts unavailable');
    mocks.enterpriseReceipts.mockRejectedValue(failure);
    mocks.groupReceipts.mockResolvedValue({ checked: 4, invalidDevices: 1 });
    await expect(handler({ task: 'pushReceipts' })).rejects.toBe(failure);
    expect(mocks.groupReceipts).toHaveBeenCalledOnce();
    expect(mocks.info).toHaveBeenCalledWith(
      { checked: 4, invalidDevices: 1 }, 'Checked group push receipts',
    );
  });

  it('surfaces group Expo receipt outages to the Lambda retry mechanism', async () => {
    const failure = new Error('Expo receipts HTTP 503');
    mocks.groupReceipts.mockRejectedValue(failure);
    await expect(handler({ task: 'pushReceipts' })).rejects.toBe(failure);
    expect(mocks.enterpriseReceipts).toHaveBeenCalledOnce();
  });

  it('checks group receipts on the one-time schedule run, so no all-day receipt job is needed', async () => {
    mocks.groupReceipts.mockResolvedValue({ checked: 2, invalidDevices: 0 });
    await handler({ task: 'departureAlerts' });
    expect(mocks.groupReceipts).toHaveBeenCalledOnce();
    expect(mocks.info).toHaveBeenCalledWith({ checked: 2, invalidDevices: 0 }, 'Checked group push receipts');
  });

  it('still re-arms when receipts fail, then surfaces the failure for a retry', async () => {
    const failure = new Error('Expo receipts HTTP 503');
    mocks.groupReceipts.mockRejectedValue(failure);
    await expect(handler({ task: 'departureAlerts' })).rejects.toBe(failure);
    expect(mocks.next).toHaveBeenCalledExactlyOnceWith({ onlyEarlier: false, rethrow: true });
  });

  it('the night backstop leaves the database asleep while the watchdog is running', async () => {
    mocks.watchdogRunning.mockResolvedValue(true);
    await handler({ task: 'departureAlerts', backstop: true });
    expect(mocks.groupAlerts).not.toHaveBeenCalled();
    expect(mocks.groupReceipts).not.toHaveBeenCalled();
    expect(mocks.next).not.toHaveBeenCalled();
  });

  it('the night backstop checks everything itself when no watchdog is running', async () => {
    await handler({ task: 'departureAlerts', backstop: true });
    expect(mocks.groupAlerts).toHaveBeenCalledOnce();
    expect(mocks.next).toHaveBeenCalledExactlyOnceWith({ onlyEarlier: false, rethrow: true });
  });

  it('a re-arm failure on the scheduled run fails it, so EventBridge retries', async () => {
    const failure = new Error('Scheduler throttled');
    mocks.next.mockRejectedValue(failure);
    await expect(handler({ task: 'departureAlerts' })).rejects.toBe(failure);
  });
});

