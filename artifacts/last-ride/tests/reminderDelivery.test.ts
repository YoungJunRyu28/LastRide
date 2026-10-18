import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    alarmStatus: vi.fn(async () => 'authorized'),
    alarmSchedule: vi.fn(async (_id: string, _fireAt: number, _title: string, _sound: string, _stop: string) => {}),
    alarmCancel: vi.fn(async () => {}),
    notificationSchedule: vi.fn(async () => 'notification-id'),
    notificationCancel: vi.fn(async () => {}),
    notificationCancelAll: vi.fn(async () => {}),
  };
});

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => mocks.store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { mocks.store.set(key, value); }),
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
  cancelAllScheduledNotificationsAsync: mocks.notificationCancelAll,
  SchedulableTriggerInputTypes: { DATE: 'date', CALENDAR: 'calendar' },
}));
vi.mock('../modules/last-ride-alarm/src', () => ({
  alarmKitAvailable: true,
  alarmKit: {
    status: mocks.alarmStatus,
    request: vi.fn(async () => 'authorized'),
    schedule: mocks.alarmSchedule,
    cancelAll: mocks.alarmCancel,
    preview: vi.fn(async () => {}),
  },
  iosMajorVersion: 26,
}));

import { readSettings, STORAGE_KEYS } from '@/lib/settings';
import { cancelAllReminders, markReminderChange, scheduleReminders } from '@/lib/notifications';

const text = { leaveBy: '23:10', station: '新宿', language: 'ja' as const };

describe('reminder delivery', () => {
  beforeEach(async () => {
    await cancelAllReminders();
    mocks.store.clear();
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

  it('schedules AlarmKit alarms for alarm times with Apple\'s alarm sound (whatever tone is chosen) and a localised Stop button', async () => {
    const now = Date.now();
    await scheduleReminders([
      { minutesBefore: 5, fireAt: now + 120000 },
      { minutesBefore: 0, fireAt: now + 180000, alarm: true },
    ], text, { sound: 'chime', vibrate: true });
    expect(mocks.alarmSchedule).toHaveBeenCalledOnce();
    // Only Apple's alarm sound rings through silent mode, so a chosen tone isn't used for real alarms.
    expect(mocks.alarmSchedule.mock.calls[0].slice(3)).toEqual(['default', '停止']);
    // The 5-minute notification, plus a silent companion for the alarm that keeps its details.
    expect(mocks.notificationSchedule).toHaveBeenCalledTimes(2);
    const [reminder, companion] = (mocks.notificationSchedule.mock.calls as unknown as [{ content: Record<string, unknown> }][]).map(([request]) => request.content);
    expect(reminder).toMatchObject({ sound: true, interruptionLevel: 'timeSensitive' });
    expect(companion).toMatchObject({ sound: false, interruptionLevel: 'passive' });
  });

  it('schedules iOS reminders at a clock time (Japan time, to the second), not "in N seconds"', async () => {
    // 23:26:00 JST: a time-interval trigger arrives ~20 s late with the phone asleep; a calendar one doesn't.
    const fireAt = Date.UTC(2099, 9, 18, 14, 26, 0);
    vi.useFakeTimers({ now: fireAt - 30 * 60_000 });
    try {
      await scheduleReminders([{ minutesBefore: 10, fireAt }], text);
      const [{ trigger }] = mocks.notificationSchedule.mock.calls[0] as unknown as [{ trigger: Record<string, unknown> }];
      expect(trigger).toEqual({ type: 'calendar', timezone: 'Asia/Tokyo', year: 2099, month: 10, day: 18, hour: 23, minute: 26, second: 0, repeats: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('makes every leave reminder Time Sensitive (即時通知), but not the missed-train check-in', async () => {
    const now = Date.now();
    await scheduleReminders([
      { minutesBefore: 15, fireAt: now + 120000 },
      { minutesBefore: 0, fireAt: now + 180000 },
      { minutesBefore: 0, fireAt: now + 240000, missedCheckIn: true },
    ], text, { sound: 'default', vibrate: true });
    const levels = (mocks.notificationSchedule.mock.calls as unknown as [{ content: Record<string, unknown> }][]).map(([request]) => request.content.interruptionLevel);
    expect(levels).toEqual(['timeSensitive', 'timeSensitive', 'active']);
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

  it('cancels native alarms when resetting and rescheduling', async () => {
    await scheduleReminders([{ minutesBefore: 5, fireAt: Date.now() + 90000 }], text);
    await cancelAllReminders();
    expect(mocks.alarmCancel).toHaveBeenCalledTimes(2);
    expect(mocks.notificationCancel).toHaveBeenCalled();
    // Everything still scheduled goes too, not just the tracked ids (the background
    // task keeps its own list, so a silent alarm companion could otherwise survive).
    expect(mocks.notificationCancelAll).toHaveBeenCalledTimes(2);
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

  it('the station notice names the train, departure and leave time of one plan, and says why the slot moved', async () => {
    mocks.store.delete(STORAGE_KEYS.reminderLedger);
    const start = Date.now();
    const info = (stationKey: string, trainLabel: string, trainDeparts: string, movedFrom?: string) => ({
      night: '20261016', choiceKey: '2', stationKey, leaveAtMs: start + 600_000, trainDepartsAtMs: start + 1_200_000,
      trainLabel, trainDeparts, movedFrom,
    });
    try {
      vi.useFakeTimers({ now: start });
      await scheduleReminders([{ minutesBefore: 0, fireAt: start + 60_000 }], text, undefined, info('新宿', '2本前', '23:20'));
      vi.setSystemTime(start + 120_000);
      // 今すぐ出発 went out; the station changes, and 2本前 there can't be made in time.
      await scheduleReminders([{ minutesBefore: 0, fireAt: start + 600_000 }], { ...text, station: '新宿三丁目', leaveBy: '23:22' }, undefined,
        info('新宿三丁目', '1本前', '23:31', '2本前'));
      const notice = (mocks.notificationSchedule.mock.calls as unknown as Array<[{ content: { title: string; body: string } }]>)
        .map(([request]) => request.content)
        .find((content) => content.title === 'LastRide — 出発駅が変わりました');
      expect(notice?.body).toBe('新宿三丁目から1本前（23:31発）。23:22に出る。2本前は出る時刻を過ぎていたため、1本前にしています。');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a change the user just made is seen by every re-plan (the background task too): no 「出る時刻が変わりました」', async () => {
    mocks.store.delete(STORAGE_KEYS.reminderLedger);
    const start = Date.now();
    const info = (leaveAtMs: number) => ({
      night: '20261016', choiceKey: '0', stationKey: '新宿', leaveAtMs, trainDepartsAtMs: start + 7_200_000,
      trainLabel: '終電', trainDeparts: '00:10',
    });
    const at = (leave: number) => [{ minutesBefore: 30, fireAt: leave - 1_800_000 }, { minutesBefore: 0, fireAt: leave }];
    try {
      vi.useFakeTimers({ now: start });
      await scheduleReminders(at(start + 1_810_000), text, undefined, info(start + 1_810_000));
      vi.setSystemTime(start + 60_000); // 30分前 has gone out
      markReminderChange('user', start + 60_000); // another destination for tonight
      vi.setSystemTime(start + 70_000);
      await scheduleReminders(at(start + 3_000_000), text, undefined, info(start + 3_000_000));
      const titles = (mocks.notificationSchedule.mock.calls as unknown as Array<[{ content: { title: string } }]>).map(([request]) => request.content.title);
      expect(titles).not.toContain('LastRide — 出る時刻が変わりました');
      // Long after the change, once 30分前 has gone out at the new time, a real move is told again.
      vi.setSystemTime(start + 1_300_000);
      await scheduleReminders(at(start + 3_600_000), text, undefined, info(start + 3_600_000));
      const later = (mocks.notificationSchedule.mock.calls as unknown as Array<[{ content: { title: string } }]>).map(([request]) => request.content.title);
      expect(later).toContain('LastRide — 出る時刻が変わりました');
    } finally {
      vi.useRealTimers();
    }
  });
});
