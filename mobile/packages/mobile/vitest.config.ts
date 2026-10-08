import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@fleet/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)), '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['test/**/*.test.ts', '../shared/test/**/*.test.ts'], environment: 'node',
    coverage: {
      provider: 'v8', reporter: ['text-summary', 'text'], include: ['src/core/**/*.ts', 'src/format.ts', '../shared/src/**/*.ts'],
      // Native-only adapters (SQLite, GPS) and the React data hook cannot run in Node; they are covered by the integration tests via the in-memory store / on device.
      exclude: ['src/core/sqliteQueueStore.ts', 'src/core/location.ts', 'src/core/lists.ts'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
