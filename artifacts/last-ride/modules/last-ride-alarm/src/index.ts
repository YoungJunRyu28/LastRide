import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type AlarmAuthorization = 'unsupported' | 'authorized' | 'denied' | 'notDetermined';

type NativeAlarmModule = {
  authorizationStatus(): Promise<AlarmAuthorization>;
  requestAuthorization(): Promise<AlarmAuthorization>;
  scheduleAlarm(id: string, fireAtMs: number, title: string, sound: string): Promise<void>;
  cancelAll(): Promise<void>;
};

const native = Platform.OS === 'ios' && Number(Platform.Version) >= 26
  ? requireOptionalNativeModule<NativeAlarmModule>('LastRideAlarm')
  : null;
export const alarmKitAvailable = native !== null;
export const alarmKit = {
  status: (): Promise<AlarmAuthorization> => native?.authorizationStatus() ?? Promise.resolve('unsupported'),
  request: (): Promise<AlarmAuthorization> => native?.requestAuthorization() ?? Promise.resolve('unsupported'),
  schedule: (id: string, fireAtMs: number, title: string, sound: string): Promise<void> =>
    native ? native.scheduleAlarm(id, fireAtMs, title, sound) : Promise.reject(new Error('AlarmKit unavailable')),
  cancelAll: (): Promise<void> => native?.cancelAll() ?? Promise.resolve(),
};
