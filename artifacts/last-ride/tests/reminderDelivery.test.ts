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
  SchedulableTriggerInputTypes: { DATE: 'date' },
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
import { cancelAllReminders, scheduleReminders } from '@/lib/notifications';

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
});
