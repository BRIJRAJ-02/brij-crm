import { defineConfig } from 'vitest/config';

// The engine's integration tests run against a real Postgres (never a mocked
// one): the global setup creates and migrates `crm_test_core` first.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
