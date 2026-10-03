/**
 * Stands in for `@/lib/api` under Vitest.
 *
 * The real module reads `react-native` and `expo-constants` at import time to
 * work out the API base URL. Neither parses outside a React Native bundler, and
 * the pure functions these tests cover never make a request — they only need
 * the module graph to resolve. See vitest.config.ts.
 */
export const apiBaseUrl = 'https://api.test.invalid';
export const isDevelopment = false;
export const communityFallbacksEnabled = false;
