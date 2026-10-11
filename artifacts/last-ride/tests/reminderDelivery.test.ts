import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    alarmStatus: vi.fn(async () => 'authorized'),
    alarmSchedule: vi.fn(async (_id: string, _fireAt: number, _title: string, _sound: string) => {}),
    alarmCancel: vi.fn(async () => {}),
    notificationSchedule: vi.fn(async () => 'notification-id'),
    notificationCancel: vi.fn(async () => {}),
  };
});

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => mocks.store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { mocks.store.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { mocks.store.delete(key); }),
  },
}));
vi.mock('react-native', () => ({ Platform: { OS: 'ios', Version: 26 } }));
vi.mock('expo-notifications', () => ({
  setNotificationHandler: vi.fn(),
  getPermissionsAsync: vi.fn(async () => ({ granted: true })),
  scheduleNotificationAsync: mocks.notificationSchedule,
  cancelScheduledNotificationAsync: mocks.notificationCancel,
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));
vi.mock('../modules/last-ride-alarm/src', () => ({
  alarmKitAvailable: true,
  alarmKit: {
    status: mocks.alarmStatus,
    request: vi.fn(async () => 'authorized'),
    schedule: mocks.alarmSchedule,
    cancelAll: mocks.alarmCancel,
  },
}));

import { DEFAULT_REMINDER_PREFERENCES, parseReminderPreferences } from '@/lib/settings';
import { cancelAllReminders, scheduleReminders } from '@/lib/notifications';

const text = { leaveBy: '23:10', station: '新宿', language: 'ja' as const };

describe('per-reminder delivery', () => {
  beforeEach(async () => {
    await cancelAllReminders();
    mocks.store.clear();
    vi.clearAllMocks();
    mocks.alarmStatus.mockResolvedValue('authorized');
  });

  it('defaults to non-disruptive standard notifications, including leave-now', () => {
    expect(parseReminderPreferences(null)[5]).toEqual({
      mode: 'notification', vibrate: true, sound: 'default',
    });
    expect(parseReminderPreferences(null)[0].mode).toBe('notification');
  });

  it('validates saved preferences and ignores invalid inputs', () => {
    const result = parseReminderPreferences(JSON.stringify({
      5: { mode: 'alarm', vibrate: false, sound: 'urgent' },
      10: { mode: 'malicious', vibrate: 'no', sound: '../../other' },
      999: { mode: 'alarm', sound: 'pulse' },
    }));
    expect(result[5]).toEqual({ mode: 'alarm', vibrate: false, sound: 'urgent' });
    expect(result[10]).toEqual({ mode: 'notification', vibrate: true, sound: 'default' });
    expect(result[999]).toBeUndefined();
  });

  it('schedules true iOS AlarmKit alarms for selected lead times and regular notifications for others', async () => {
    const now = Date.now();
    const preferences = {
      ...DEFAULT_REMINDER_PREFERENCES,
      5: { mode: 'alarm' as const, vibrate: true, sound: 'chime' as const },
    };
    await scheduleReminders([
      { minutesBefore: 5, fireAt: now + 120000 },
      { minutesBefore: 0, fireAt: now + 180000 },
    ], text, preferences);
    expect(mocks.alarmSchedule).toHaveBeenCalledOnce();
    expect(mocks.alarmSchedule.mock.calls[0][3]).toBe('chime');
    expect(mocks.notificationSchedule).toHaveBeenCalledOnce();
  });

  it('falls back to ordinary notifications when system-alarm permission is denied', async () => {
    mocks.alarmStatus.mockResolvedValue('denied');
    const preferences = {
      ...DEFAULT_REMINDER_PREFERENCES,
      10: { mode: 'alarm' as const, vibrate: true, sound: 'pulse' as const },
    };
    await scheduleReminders([{ minutesBefore: 10, fireAt: Date.now() + 90000 }], text, preferences);
    expect(mocks.alarmSchedule).not.toHaveBeenCalled();
    expect(mocks.notificationSchedule).toHaveBeenCalledOnce();
  });

  it('cancels native alarms when resetting and rescheduling', async () => {
    await scheduleReminders([{ minutesBefore: 5, fireAt: Date.now() + 90000 }], text);
    await cancelAllReminders();
    expect(mocks.alarmCancel).toHaveBeenCalledTimes(2);
    expect(mocks.notificationCancel).toHaveBeenCalled();
  });

  it('does not schedule stale alarms from a delayed background callback', async () => {
    await scheduleReminders([{ minutesBefore: 5, fireAt: Date.now() - 120000 }], text);
    expect(mocks.alarmSchedule).not.toHaveBeenCalled();
    expect(mocks.notificationSchedule).not.toHaveBeenCalled();
  });
});
