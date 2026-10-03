/**
 * Build-time feature switches. EXPO_PUBLIC_* values are inlined when the
 * bundle is built, so changing one needs a new build or update.
 */

/**
 * LastRide for Business: joining groups, organizer events and organizer
 * alerts. On unless the build sets EXPO_PUBLIC_ENABLE_BUSINESS=false, which
 * hides every entry point and sends deep links (e.g. last-ride://join) home.
 */
export const businessEnabled =
  process.env.EXPO_PUBLIC_ENABLE_BUSINESS !== "false";
