// The app's flow tests (spec 0005, AC-41): Playwright against a running app,
// locally `pnpm dev` (or `pnpm dev:apps` with Postgres and Mailpit up). Sign
// in codes are read back from Mailpit. Files are `e2e/*.flow.ts`, so Vitest's
// unit run never picks them up. CI runs them from milestone 4.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.flow.ts',
  // One person at a time: the flows share one database and one mail catcher.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    // FLOW_BASE_URL points the flows at another running app (a second checkout on another port).
    baseURL: process.env.FLOW_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  // The flows at a desktop width and at a phone's, where the sidebar folds to its rail.
  projects: [
    { name: '1280', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: '375', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 }, hasTouch: true } },
  ],
});
