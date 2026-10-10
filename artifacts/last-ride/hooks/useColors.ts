import colors from '@/constants/colors';

/**
 * The app's design tokens. LastRide is always dark (it is used at night), so
 * there is a single palette whatever the device's appearance setting.
 */
export function useColors() {
  return { ...colors.dark, radius: colors.radius };
}
