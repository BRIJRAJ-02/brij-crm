import { defineConfig } from 'vitest/config';

// The engine's integration tests run against a real Postgres (never a mocked
// one): the global setup creates and migrates `crm_test_core` first.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // On CI only, a failed test runs up to twice more: timing tests outran GitHub's 2 core runner on main four
    // times on 8 October 2026, and a red main skips Railway's deploy. Vitest still reports each retry.
    retry: process.env.CI === 'true' ? 2 : 0,
  },
});
