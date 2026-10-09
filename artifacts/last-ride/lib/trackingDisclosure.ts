/**
 * Prominent, single-purpose background-location disclosure shown before the
 * night-tracking permission requests on iOS and Android.
 *
 * Do not mention experimental learning or claim that position is never sent:
 * location is sent to our API/routing providers for current travel planning.
 */
import type { Language } from '@/lib/settings';

export type TrackingDisclosure = {
  title: string;
  message: string;
  foregroundOnly: string;
  allowBackground: string;
};

export function trackingDisclosure(language: Language | null): TrackingDisclosure {
  if (language === 'ja') {
    return {
      title: '夜の位置情報の使用',
      message:
        'LastRideは、夜のトラッキング中、アプリを閉じている間も位置情報を取得し、近くの駅、徒歩時間、出発時刻とリマインダーを更新します。位置情報は経路検索のためにAPIや経路提供会社に送信される場合があります。アプリ使用中のみを選ぶと、閉じている間は位置情報を更新せず、最後に計算した予定に基づく通知を使用します。',
      foregroundOnly: 'アプリ使用中のみ',
      allowBackground: 'バックグラウンドも許可',
    };
  }
  return {
    title: 'Night tracking location',
    message:
      'LastRide collects location data during night tracking to update nearby stations, walking times, departure times, and reminders even when the app is closed or not in use. Location may be sent to our API and routing providers to calculate your journey. Choose Only while app is open to stop location updates when the app is closed; reminders then use your last calculated plan.',
    foregroundOnly: 'Only while app is open',
    allowBackground: 'Allow background location',
  };
}
