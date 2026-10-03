import { defineConfig } from 'vitest/config';

// The sign in and procedure tests run against a real Postgres (never a mocked
// one): the global setup creates and migrates `crm_test_api` first. The code
// sign in tests also need Mailpit (`docker compose up -d mailpit`).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // The sign in suites share one Mailpit inbox and the rate limit table.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
