/**
 * The last known premium state, kept on disk so code that runs without the
 * React tree (the background location task) can gate premium features such
 * as the Live Activity. PremiumProvider keeps it current.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREMIUM_CACHE_KEY = 'lastride-premium-active';

export async function writePremiumCache(active: boolean): Promise<void> {
  await AsyncStorage.setItem(PREMIUM_CACHE_KEY, String(active)).catch(() => undefined);
}

export async function readPremiumCache(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PREMIUM_CACHE_KEY)) === 'true';
  } catch {
    return false;
  }
}
