import { describe, expect, it } from 'vitest';
import { isNativeReminderScheduleIntact } from '@/lib/notificationScheduleHealth';
const t = 1_000_000;
describe('reconcile native reminders after iOS/Android system schedule loss', () => {
  const pending = [{ id: 'a', fireAt: t + 60_000 }, { id: 'b', fireAt: t + 120_000 }];
  it('accepts only the complete native set and does not reschedule a healthy plan', () => {
    expect(isNativeReminderScheduleIntact(2, pending, new Set(['a', 'b', 'other-app']), t)).toBe(true);
  });
  it('reschedules when a scheduled notification has been deleted or OS has reset pending notifications', () => {
    expect(isNativeReminderScheduleIntact(2, pending, new Set(['a']), t)).toBe(false);
    expect(isNativeReminderScheduleIntact(2, pending, new Set(), t)).toBe(false);
  });
  it('reschedules after app crash between writing schedule signature and recording native identifier', () => {
    expect(isNativeReminderScheduleIntact(2, [pending[0]], new Set(['a', 'b']), t)).toBe(false);
    expect(isNativeReminderScheduleIntact(2, [], new Set(['a', 'b']), t)).toBe(false);
  });
  it('rejects duplicate identifiers and impossible stored entries', () => {
    expect(isNativeReminderScheduleIntact(2, [pending[0], pending[0]], new Set(['a']), t)).toBe(false);
    expect(isNativeReminderScheduleIntact(2, [{ id: 'a', fireAt: NaN }, pending[1]], new Set(['a', 'b']), t)).toBe(false);
  });
  it('ignores already-fired identifiers if a future set no longer needs them', () => {
    expect(isNativeReminderScheduleIntact(1, [pending[0], { id: 'past', fireAt: t - 5000 }], new Set(['a']), t)).toBe(true);
    expect(isNativeReminderScheduleIntact(0, [], new Set(), t)).toBe(true);
  });
});
