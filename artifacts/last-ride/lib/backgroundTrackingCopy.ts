import type { Language } from '@/lib/settings';

/** Android's persistent foreground-service notice must use the actual app
 * language and explicitly identify location access. This is a persistent
 * system notification, not a promise that a train or alarm is guaranteed. */
export function backgroundTrackingNotification(language: Language | null): {
  notificationTitle: string;
  notificationBody: string;
} {
  return language === 'ja'
    ? {
        notificationTitle: 'LastRide：位置情報を使用中',
        notificationBody: '帰宅案内のため、近くの駅と出発時刻を確認しています。',
      }
    : {
        notificationTitle: 'LastRide is using your location',
        notificationBody: 'Checking nearby stations and departure times for tonight.',
      };
}

/** Include locale in the OS task configuration identity. Otherwise changing
 * the app language leaves Android's prior-language notice on the lock screen
 * until its accuracy/distance profile happens to change. */
export function backgroundTrackingProfileKey(profile: string, language: Language | null): string {
  return profile + ':' + (language === 'ja' ? 'ja' : 'en');
}
