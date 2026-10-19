import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const store = new Map<string, string>();
  const pending = new Map<string, { identifier: string; content?: { sound?: unknown; interruptionLevel?: unknown; data?: Record<string, unknown> } }>();
  const nativeAlarms = new Set<string>();
  const nativeAlarmQueryFails = { value: false };
  const nativeAlarmReceiptFails = { value: false };
  let serial = 0;
  return {
    store,
    pending,
    nativeAlarms,
    nativeAlarmQueryFails,
    nativeAlarmReceiptFails,
    alarmStatus: vi.fn(async () => 'authorized'),
    alarmSchedule: vi.fn(async (id: string, _fireAt: number, _title: string, _sound: string, _stop: string) => { nativeAlarms.add(id); }),
    alarmCancel: vi.fn(async () => { nativeAlarms.clear(); }),
    alarmScheduledIds: vi.fn(async () => nativeAlarmQueryFails.value ? null : [...nativeAlarms]),
    notificationSchedule: vi.fn(async (request: { identifier?: string; trigger: unknown; content: { sound?: unknown; interruptionLevel?: unknown; data?: Record<string, unknown> } }) => {
      const id = request.identifier ?? `generated-${++serial}`;
      if (request.trigger !== null) pending.set(id, { identifier: id, content: request.content });
      return id;
    }),
    notificationCancel: vi.fn(async (id: string) => { pending.delete(id); }),
    notificationGetPending: vi.fn(async () => [...pending.values()]),
  };
});

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => mocks.store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      if (key === 'lastride-scheduled-alarmkit-v1' && mocks.nativeAlarmReceiptFails.value) {
        throw new Error('Simulated native alarm receipt write failed');
      }
      mocks.store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => { mocks.store.delete(key); }),
    multiRemove: vi.fn(async (keys: string[]) => { keys.forEach((key) => mocks.store.delete(key)); }),
  },
}));
vi.mock('react-native', () => ({ Platform: { OS: 'ios', Version: 26 } }));
vi.mock('expo-notifications', () => ({
  setNotificationHandler: vi.fn(),
  getPermissionsAsync: vi.fn(async () => ({ granted: true })),
  scheduleNotificationAsync: mocks.notificationSchedule,
  cancelScheduledNotificationAsync: mocks.notificationCancel,
  getAllScheduledNotificationsAsync: mocks.notificationGetPending,
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));
vi.mock('../modules/last-ride-alarm/src', () => ({
  alarmKitAvailable: true,
  alarmKit: {
    status: mocks.alarmStatus,
    request: vi.fn(async () => 'authorized'),
    schedule: mocks.alarmSchedule,
    cancelAll: mocks.alarmCancel,
    scheduledIds: mocks.alarmScheduledIds,
    preview: vi.fn(async () => {}),
  },
  iosMajorVersion: 26,
}));

import { readSettings, STORAGE_KEYS } from '@/lib/settings';
import { cancelAllReminders, scheduleReminders } from '@/lib/notifications';

const text = { leaveBy: '23:10', station: '新宿', language: 'ja' as const };

describe('reminder delivery', () => {
  beforeEach(async () => {
    await cancelAllReminders();
    mocks.store.clear();
    mocks.pending.clear();
    mocks.nativeAlarms.clear();
    mocks.nativeAlarmQueryFails.value = false;
    mocks.nativeAlarmReceiptFails.value = false;
    vi.clearAllMocks();
    mocks.alarmStatus.mockResolvedValue('authorized');
  });

  it('defaults to notifications at 15 minutes and the leave time, with alarms off', async () => {
    const settings = await readSettings();
    expect(settings.reminderIntervals).toEqual([15, 0]);
    expect(settings.alarmsEnabled).toBe(false);
    expect(settings.alarmIntervals).toEqual([]);
    expect(settings.alarmSound).toBe('default');
  });

  it('reads saved alarm times, keeps a time out of both lists, and ignores bad values', async () => {
    mocks.store.set(STORAGE_KEYS.reminders, JSON.stringify([30, 15, 0, 999]));
    mocks.store.set(STORAGE_KEYS.alarmsEnabled, 'true');
    mocks.store.set(STORAGE_KEYS.alarmTimes, JSON.stringify([0, 'x']));
    mocks.store.set(STORAGE_KEYS.alarmSound, '../../other');
    const settings = await readSettings();
    expect(settings.reminderIntervals).toEqual([30, 15]);
    expect(settings.alarmIntervals).toEqual([0]);
    expect(settings.alarmSound).toBe('default');
  });

  it('ignores saved alarm times while alarms are off', async () => {
    mocks.store.set(STORAGE_KEYS.alarmTimes, JSON.stringify([0]));
    expect((await readSettings()).alarmIntervals).toEqual([]);
  });

  it('schedules AlarmKit alarms for alarm times with the chosen sound and a localised Stop button', async () => {
    const now = Date.now();
    await scheduleReminders([
      { minutesBefore: 5, fireAt: now + 120000 },
      { minutesBefore: 0, fireAt: now + 180000, alarm: true },
    ], text, { sound: 'chime', vibrate: true });
    expect(mocks.alarmSchedule).toHaveBeenCalledOnce();
    expect(mocks.alarmSchedule.mock.calls[0].slice(3)).toEqual(['chime', '停止']);
    // The 5-minute notification, plus a silent companion for the alarm that keeps its details.
    expect(mocks.notificationSchedule).toHaveBeenCalledTimes(2);
    const [reminder, companion] = (mocks.notificationSchedule.mock.calls as unknown as [{ content: Record<string, unknown> }][]).map(([request]) => request.content);
    expect(reminder).toMatchObject({ sound: true, interruptionLevel: 'active' });
    expect(companion).toMatchObject({ sound: false, interruptionLevel: 'passive' });
  });

  it('makes the leave-now reminder Time Sensitive, but not the earlier ones', async () => {
    const now = Date.now();
    await scheduleReminders([
      { minutesBefore: 15, fireAt: now + 120000 },
      { minutesBefore: 0, fireAt: now + 180000 },
    ], text, { sound: 'default', vibrate: true });
    const levels = (mocks.notificationSchedule.mock.calls as unknown as [{ content: Record<string, unknown> }][]).map(([request]) => request.content.interruptionLevel);
    expect(levels).toEqual(['active', 'timeSensitive']);
  });

  it('falls back to a notification with the chosen tone when alarms are not allowed', async () => {
    mocks.alarmStatus.mockResolvedValue('denied');
    await scheduleReminders([{ minutesBefore: 10, fireAt: Date.now() + 90000, alarm: true }], text, { sound: 'pulse', vibrate: true });
    expect(mocks.alarmSchedule).not.toHaveBeenCalled();
    expect(mocks.notificationSchedule).toHaveBeenCalledOnce();
    expect(mocks.notificationSchedule.mock.calls[0]).toMatchObject([{ content: { sound: 'lastride_pulse.caf' } }]);
  });

  it('plays the default sound for ordinary notifications', async () => {
    await scheduleReminders([{ minutesBefore: 10, fireAt: Date.now() + 90000 }], text, { sound: 'urgent', vibrate: true });
    expect(mocks.notificationSchedule.mock.calls[0]).toMatchObject([{ content: { sound: true } }]);
  });

  it('does not churn an unchanged reminder schedule when OS still holds it', async () => {
    const plans = [{ minutesBefore: 5, fireAt: Date.now() + 180000 }];
    await scheduleReminders(plans, text);
    expect(mocks.notificationSchedule).toHaveBeenCalledTimes(1);
    await scheduleReminders(plans, text);
    expect(mocks.notificationSchedule).toHaveBeenCalledTimes(1);
    expect(mocks.notificationGetPending).toHaveBeenCalled();
  });

  it('rebuilds reminders on the next replan after native OS notifications are deleted', async () => {
    const plans = [
      { minutesBefore: 15, fireAt: Date.now() + 240000 },
      { minutesBefore: 0, fireAt: Date.now() + 300000 },
    ];
    await scheduleReminders(plans, text);
    expect(mocks.notificationSchedule).toHaveBeenCalledTimes(2);
    const ids = [...mocks.pending.keys()];
    mocks.pending.delete(ids[0]); // iOS/Android system or app settings cleared one alarm
    await scheduleReminders(plans, text);
    expect(mocks.notificationSchedule).toHaveBeenCalledTimes(4);
    expect(mocks.pending.size).toBe(2);
  });

  it('rebuilds an iOS AlarmKit alarm if the native OS loses it but its silent companion survives', async () => {
    const plans = [{ minutesBefore: 0, fireAt: Date.now() + 240_000, alarm: true as const }];
    await scheduleReminders(plans, text);
    expect(mocks.alarmSchedule).toHaveBeenCalledTimes(1);
    expect(mocks.pending.size).toBe(1);
    expect(mocks.nativeAlarms.size).toBe(1);
    await scheduleReminders(plans, text);
    expect(mocks.alarmSchedule).toHaveBeenCalledTimes(1); // healthy native alarm: no churn
    mocks.nativeAlarms.clear(); // iOS has removed the actual alarm, not its companion
    expect(mocks.pending.size).toBe(1);
    await scheduleReminders(plans, text);
    expect(mocks.alarmSchedule).toHaveBeenCalledTimes(2);
    expect(mocks.nativeAlarms.size).toBe(1);
    expect(mocks.pending.size).toBe(1);
  });

  it('rebuilds AlarmKit alarms after the persisted native receipt vanishes', async () => {
    const plans = [{ minutesBefore: 0, fireAt: Date.now() + 240_000, alarm: true as const }];
    await scheduleReminders(plans, text);
    mocks.store.delete('lastride-scheduled-alarmkit-v1');
    await scheduleReminders(plans, text);
    expect(mocks.alarmSchedule).toHaveBeenCalledTimes(2);
  });

  it('does not pretend native AlarmKit is healthy when its scheduled-ID query fails', async () => {
    const plans = [{ minutesBefore: 0, fireAt: Date.now() + 240_000, alarm: true as const }];
    await scheduleReminders(plans, text);
    mocks.nativeAlarmQueryFails.value = true;
    await scheduleReminders(plans, text);
    expect(mocks.alarmSchedule).toHaveBeenCalledTimes(2);
  });

  it('does not schedule duplicate audible reminders when storing a successful native alarm receipt fails', async () => {
    mocks.nativeAlarmReceiptFails.value = true;
    const plans = [{ minutesBefore: 0, fireAt: Date.now() + 240_000, alarm: true as const }];
    await scheduleReminders(plans, text);
    expect(mocks.alarmSchedule).toHaveBeenCalledTimes(1);
    expect(mocks.notificationSchedule).toHaveBeenCalledTimes(1);
    const [scheduled] = mocks.notificationSchedule.mock.calls;
    expect(scheduled?.[0].content).toMatchObject({
      sound: false, interruptionLevel: 'passive',
      data: { lastrideAlarmCompanion: true },
    });
    // Failure to persist a native receipt MUST NOT mark the plan reconciled.
    expect(mocks.store.has('lastride-reminder-signature')).toBe(false);
    mocks.nativeAlarmReceiptFails.value = false;
    await scheduleReminders(plans, text);
    expect(mocks.alarmSchedule).toHaveBeenCalledTimes(2);
    expect(mocks.nativeAlarms.size).toBe(1);
  });

  it('does not require AlarmKit reconciliation when a denied alarm uses an audible notification fallback', async () => {
    mocks.alarmStatus.mockResolvedValue('denied');
    const plans = [{ minutesBefore: 0, fireAt: Date.now() + 240_000, alarm: true as const }];
    await scheduleReminders(plans, text);
    await scheduleReminders(plans, text);
    expect(mocks.alarmSchedule).not.toHaveBeenCalled();
    expect(mocks.notificationSchedule).toHaveBeenCalledTimes(1);
  });

  it('cancels orphan OS alarms even when a killed headless task missed the storage receipt', async () => {
    mocks.pending.set('lastride-local-crash-orphan', { identifier: 'lastride-local-crash-orphan' });
    mocks.pending.set('other-feature-reminder', { identifier: 'other-feature-reminder' });
    await cancelAllReminders();
    expect(mocks.pending.has('lastride-local-crash-orphan')).toBe(false);
    expect(mocks.pending.has('other-feature-reminder')).toBe(true);
  });

  it('cancels native alarms when resetting and rescheduling', async () => {
    await scheduleReminders([{ minutesBefore: 5, fireAt: Date.now() + 90000 }], text);
    await cancelAllReminders();
    expect(mocks.alarmCancel).toHaveBeenCalledTimes(2);
    expect(mocks.notificationCancel).toHaveBeenCalled();
  });

  it('does not schedule stale alarms from a delayed background callback', async () => {
    await scheduleReminders([{ minutesBefore: 5, fireAt: Date.now() - 120000, alarm: true }], text);
    expect(mocks.alarmSchedule).not.toHaveBeenCalled();
    expect(mocks.notificationSchedule).not.toHaveBeenCalled();
  });

  it('with tonight’s record: a small re-plan after 出る時間です never sends it again; a station change is told once, then reminders still ahead come again', async () => {
    mocks.store.delete(STORAGE_KEYS.reminderLedger);
    const start = Date.now();
    const info = (leaveAtMs: number, stationKey: string) => ({
      night: '20261016', choiceKey: '0', stationKey, leaveAtMs, trainDepartsAtMs: start + 3_600_000,
      trainLabel: '終電', trainDeparts: '23:45',
    });
    const leaveNow = (fireAt: number) => [{ minutesBefore: 0, fireAt }];
    try {
      vi.useFakeTimers({ now: start });
      await scheduleReminders(leaveNow(start + 60_000), text, { sound: 'default', vibrate: true }, info(start + 60_000, '新宿'));
      expect(mocks.notificationSchedule).toHaveBeenCalledTimes(1);
      // Two minutes later 今すぐ出発 has gone out; walking toward the station moves the leave time later.
      vi.setSystemTime(start + 120_000);
      await scheduleReminders(leaveNow(start + 300_000), text, { sound: 'default', vibrate: true }, info(start + 300_000, '新宿'));
      expect(mocks.notificationSchedule).toHaveBeenCalledTimes(1);
      // The plan switches station: one notice, sent now, and 出る時間です again at the new time.
      await scheduleReminders(leaveNow(start + 300_000), text, { sound: 'default', vibrate: true }, info(start + 300_000, '新宿三丁目'));
      expect(mocks.notificationSchedule).toHaveBeenCalledTimes(3);
      const calls = mocks.notificationSchedule.mock.calls as unknown as Array<[{ content: { title: string }; trigger: unknown }]>;
      expect(calls[1][0].content.title).toBe('LastRide — 出発駅が変わりました');
      expect(calls[1][0].trigger).toBeNull();
      expect(calls[2][0].content.title).toBe('LastRide — 出る時間です');
      expect(calls[2][0].trigger).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

