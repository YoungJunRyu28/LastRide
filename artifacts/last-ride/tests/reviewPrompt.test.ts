import { describe, expect, test, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(), setItem: vi.fn() } }));
vi.mock('expo-store-review', () => ({ isAvailableAsync: vi.fn(), hasAction: vi.fn(), requestReview: vi.fn() }));

import { shouldAskForReview } from '@/lib/reviewPrompt';

/** A Japan clock time on 5 Nov 2026. */
const jst = (hours: number) => Date.UTC(2026, 10, 5, hours - 9);
const twoNights = ['2026-11-03', '2026-11-04'];

describe('when to ask for a review', () => {
  test('after two nights, in the daytime', () => {
    expect(shouldAskForReview(jst(10), twoNights, null)).toBe(true);
  });
  test('not after only one night', () => {
    expect(shouldAskForReview(jst(10), ['2026-11-04'], null)).toBe(false);
  });
  test('never at night or in the early morning', () => {
    expect(shouldAskForReview(jst(22), twoNights, null)).toBe(false);
    expect(shouldAskForReview(jst(2), twoNights, null)).toBe(false);
    expect(shouldAskForReview(jst(7), twoNights, null)).toBe(false);
  });
  test('once per 120 days', () => {
    expect(shouldAskForReview(jst(10), twoNights, jst(10) - 30 * 24 * 3600_000)).toBe(false);
    expect(shouldAskForReview(jst(10), twoNights, jst(10) - 121 * 24 * 3600_000)).toBe(true);
  });
});
