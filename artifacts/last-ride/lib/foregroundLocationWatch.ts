import * as Location from 'expo-location';

/**
 * Starting a native location subscription is fallible even after the user
 * grants foreground permission (services can be disabled, the app may be
 * backgrounded, or Android can revoke permissions during an OS settings trip).
 * Never propagate this rejection into the UI button's fire-and-forget handler.
 */
export async function beginForegroundLocationWatch(
  onUpdate: (position: Location.LocationObject) => void,
): Promise<
  | { status: 'started'; subscription: Location.LocationSubscription }
  | { status: 'denied' | 'unavailable' }
> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return { status: 'denied' };
    const subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: 150,
        timeInterval: 120000,
      },
      onUpdate,
    );
    return { status: 'started', subscription };
  } catch {
    return { status: 'unavailable' };
  }
}
