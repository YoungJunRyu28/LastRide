/**
 * Build-time feature switches. EXPO_PUBLIC_* values are inlined when the
 * bundle is built, so changing one needs a new build or update.
 */

/**
 * LastRide for Business: organizer events and organizer alerts (consumer
 * groups are separate and always on). Not in v1: off unless the build sets
 * EXPO_PUBLIC_ENABLE_BUSINESS=true. While off, every entry point is hidden and
 * its deep links (e.g. last-ride://join) go home.
 */
export const businessEnabled =
  process.env.EXPO_PUBLIC_ENABLE_BUSINESS === "true";
