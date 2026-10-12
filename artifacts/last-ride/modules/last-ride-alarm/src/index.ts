import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type AlarmAuthorization = 'unsupported' | 'authorized' | 'denied' | 'notDetermined';

type NativeAlarmModule = {
  authorizationStatus(): Promise<AlarmAuthorization>;
  requestAuthorization(): Promise<AlarmAuthorization>;
  scheduleAlarm(id: string, fireAtMs: number, title: string, sound: string, stopLabel: string): Promise<void>;
  cancelAll(): Promise<void>;
  previewSound(fileName: string): Promise<void>;
  liveActivitiesEnabled?(): Promise<boolean>;
};

/** The iOS major version (e.g. 18), or null off iOS. */
export const iosMajorVersion = Platform.OS === 'ios' ? Number.parseInt(String(Platform.Version), 10) || null : null;

// Loaded on every iOS version for the sound preview; alarms themselves need AlarmKit (iOS 26).
const native = Platform.OS === 'ios' ? requireOptionalNativeModule<NativeAlarmModule>('LastRideAlarm') : null;
export const alarmKitAvailable = native !== null && (iosMajorVersion ?? 0) >= 26;
export const alarmKit = {
  status: (): Promise<AlarmAuthorization> => (alarmKitAvailable && native ? native.authorizationStatus() : Promise.resolve('unsupported')),
  request: (): Promise<AlarmAuthorization> => (alarmKitAvailable && native ? native.requestAuthorization() : Promise.resolve('unsupported')),
  schedule: (id: string, fireAtMs: number, title: string, sound: string, stopLabel: string): Promise<void> =>
    alarmKitAvailable && native ? native.scheduleAlarm(id, fireAtMs, title, sound, stopLabel) : Promise.reject(new Error('AlarmKit unavailable')),
  cancelAll: (): Promise<void> => (alarmKitAvailable && native ? native.cancelAll() : Promise.resolve()),
  preview: (fileName: string): Promise<void> => native?.previewSound(fileName) ?? Promise.resolve(),
};

/**
 * Whether iOS allows LastRide's Live Activities; null when unknown (other
 * platforms, or a build from before this check existed).
 */
export function liveActivitiesAllowed(): Promise<boolean | null> {
  return native?.liveActivitiesEnabled ? native.liveActivitiesEnabled().catch(() => null) : Promise.resolve(null);
}
