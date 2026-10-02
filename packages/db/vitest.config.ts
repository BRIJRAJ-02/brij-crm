import { defineConfig } from 'vitest/config';

// Integration tests against a real Postgres (never a mocked one): the global
// setup creates and migrates `crm_test_db`, then each test connects as the app.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
