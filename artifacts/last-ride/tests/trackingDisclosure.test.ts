import { describe, expect, it } from 'vitest';
import { trackingDisclosure } from '../lib/trackingDisclosure';

describe('night-tracking location disclosure', () => {
  it('explains all background location uses before requesting permission', () => {
    const content = trackingDisclosure('en');
    expect(content.title.toLowerCase()).toContain('location');
    expect(content.message).toMatch(/collects location data/);
    expect(content.message).toMatch(/even when the app is closed or not in use/);
    expect(content.message).toMatch(/station.*walking.*departure.*reminder/);
    expect(content.message).toMatch(/API and routing providers/);
    expect(content.foregroundOnly).toMatch(/Only while app is open/);
    expect(content.allowBackground).toMatch(/Allow background location/);
    expect(content.message).not.toMatch(/learn|machine|ML/);
  });

  it('provides an equivalent Japanese background and open-app-only choice', () => {
    const content = trackingDisclosure('ja');
    expect(content.message).toMatch(/アプリを閉じている間も位置情報/);
    expect(content.message).toMatch(/駅、徒歩時間、出発時刻とリマインダー/);
    expect(content.message).toMatch(/APIや経路提供会社/);
    expect(content.foregroundOnly).toBe('アプリ使用中のみ');
    expect(content.allowBackground).toMatch(/バックグラウンド/);
  });

  it('falls back to English before language setup', () => {
    expect(trackingDisclosure(null)).toEqual(trackingDisclosure('en'));
  });
});
