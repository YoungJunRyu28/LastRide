import { describe, expect, it } from 'vitest';
import {
  backgroundTrackingNotification,
  backgroundTrackingProfileKey,
} from '@/lib/backgroundTrackingCopy';

describe('Android ongoing location notification', () => {
  it('uses natural Japanese and discloses location access', () => {
    expect(backgroundTrackingNotification('ja')).toEqual({
      notificationTitle: 'LastRide：位置情報を使用中',
      notificationBody: '帰宅案内のため、近くの駅と出発時刻を確認しています。',
    });
  });
  it('uses concise English when English is selected or language is unset', () => {
    expect(backgroundTrackingNotification('en').notificationTitle)
      .toBe('LastRide is using your location');
    expect(backgroundTrackingNotification(null)).toEqual(backgroundTrackingNotification('en'));
  });
  it('changes native task profile identity on a language change', () => {
    expect(backgroundTrackingProfileKey('light', 'ja')).toBe('light:ja');
    expect(backgroundTrackingProfileKey('light', 'en')).toBe('light:en');
    expect(backgroundTrackingProfileKey('normal', 'ja')).not.toBe(backgroundTrackingProfileKey('light', 'ja'));
  });
});
