import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

export type CountdownContent = {
  title: string;
  body: string;
  /** Epoch ms the chronometer counts down to. */
  countdownTo: number;
  detail?: string;
  url?: string;
  mapLabel?: string;
  mapUrl?: string;
  stopLabel?: string;
  stopUrl?: string;
  channelName?: string;
};

type NativeModule = { show(content: CountdownContent): void; dismiss(): void };

/** Null off Android or in builds without the module (Expo Go, web). */
const native = Platform.OS === 'android' ? requireOptionalNativeModule<NativeModule>('CountdownNotification') : null;

export const countdownNotificationAvailable = native !== null;

export function showCountdown(content: CountdownContent): void {
  native?.show(content);
}

export function dismissCountdown(): void {
  native?.dismiss();
}
