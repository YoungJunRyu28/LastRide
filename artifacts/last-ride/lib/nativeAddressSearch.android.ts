/** Android's OS geocoder: avoids paid Places/Geocoding API requests.
 * This is a single-address resolver, not live place autocomplete. */
import { geocodeAsync, getForegroundPermissionsAsync } from 'expo-location';
import { normalizeAndroidGeocodes } from './androidGeocode';

export async function nativeAddressSearch(query: string) {
  const permissions = await getForegroundPermissionsAsync();
  if (!permissions.granted) {
    // Never surprise the user with a runtime permission prompt per keystroke.
    throw new Error('ANDROID_GEOCODER_PERMISSION_REQUIRED');
  }
  // The Android Geocoder is network/OS dependent. Bound the search so a dead
  // system service cannot freeze location search indefinitely.
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const results = await Promise.race([
      geocodeAsync(query),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('ANDROID_GEOCODER_TIMEOUT')), 7000); }),
    ]);
    return normalizeAndroidGeocodes(query, results);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
