import { describe, expect, test } from 'vitest';
import { androidWidgetPayload } from '@/lib/androidWidgetTimeline';
import { widgetMessage, type LeaveWidgetProps, type WidgetEntry } from '@/lib/widgetContent';
import { MINUTE_MS } from '@/lib/time';

const now = Date.UTC(2026, 10, 4, 13, 0);
function entry(at: number, props: LeaveWidgetProps): WidgetEntry {
  return { date: new Date(at), props };
}

describe('Android home widget uses the existing iOS timeline safely', () => {
  test('starts at the current phase and keeps only upcoming phases', () => {
    const p = widgetMessage('en', 'no-plan');
    const timeline = [
      entry(now - MINUTE_MS, { ...p, kind: 'plan', trainTime: '23:52', trainSuffix: 'dep.', leaveLine: 'Leave 23:39', checked: 'Checked 22:10' }),
      entry(now + MINUTE_MS, { ...p, kind: 'message', message: 'Last train left', hint: 'Open to check' }),
    ];
    const result = androidWidgetPayload(timeline, 'en', now, now, true);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({ primary: '23:52 dep.', secondary: 'Leave 23:39', footer: 'Checked 22:10' });
    expect(result.entries[1].primary).toBe('Last train left');
    expect(result.expiresAt).toBe(now + 12 * MINUTE_MS);
  });

  test('a stale location check expires immediately, not after another 12 minutes', () => {
    const props = widgetMessage('en', 'no-plan');
    const result = androidWidgetPayload([entry(now, {
      ...props, kind: 'plan', trainTime: '23:52', trainSuffix: 'dep.',
    })], 'en', now, now - 30 * MINUTE_MS, true);
    expect(result.expiresAt).toBe(now);
    expect(result.staleMessage).toBe('Route needs a fresh check');
  });

  test('Premium and other non-route messages do not expire as travel advice', () => {
    const result = androidWidgetPayload([entry(now, widgetMessage('ja', 'premium'))],
      'ja', now, null, false);
    expect(result.expiresAt).toBeGreaterThan(now + 25 * MINUTE_MS);
    expect(result.entries[0].url).toBe('last-ride://paywall?from=widget');
    expect(result.openLabel).toContain('帰り時');
  });

  test('normalizes text and rejects arbitrary native widget deep links', () => {
    const base = widgetMessage('en', 'no-plan');
    const result = androidWidgetPayload([entry(now, {
      ...base, message: 'Line one\nLine two', url: 'https://example.com/',
    })], 'en', now, now, false);
    expect(result.entries[0].primary).toBe('Line one Line two');
    expect(result.entries[0].url).toBe('last-ride://ride');
  });
});
