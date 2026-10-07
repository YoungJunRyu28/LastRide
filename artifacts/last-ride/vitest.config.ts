import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Unit tests for the app's pure logic (time arithmetic, ride planning).
 *
 * `vite-tsconfig-paths` resolves the `@/` alias from tsconfig.json so tests
 * import modules exactly as the app does. Nothing here renders React Native
 * components — these are plain functions, run in Node.
 *
 * `@/lib/api` is the one exception: it pulls in react-native and
 * expo-constants at import time, which Vite cannot parse (Flow syntax). It is
 * swapped for a stub, since the functions under test never issue a request.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: [
      {
        find: /^@\/lib\/api$/,
        replacement: resolve(import.meta.dirname, 'tests/stubs/api.ts'),
      },
      {
        find: /^@\/lib\/mobilityLearning$/,
        replacement: resolve(import.meta.dirname, 'tests/stubs/mobilityLearning.ts'),
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
