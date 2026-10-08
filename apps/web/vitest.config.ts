// The web app's test projects:
//   node     the middleware, the built page, the first load and pure helpers (*.test.ts)
//   browser  what needs a real page: the Sentry SDK in Chromium (*.browser.test.tsx)
import { playwright } from '@vitest/browser-playwright';
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: 'node',
            environment: 'node',
            include: ['*.test.ts', 'src/**/*.test.ts'],
            exclude: ['**/*.browser.test.*', 'node_modules/**'],
          },
        },
        {
          extends: true,
          test: {
            name: 'browser',
            include: ['src/**/*.browser.test.tsx'],
            browser: { enabled: true, headless: true, provider: playwright(), instances: [{ browser: 'chromium' }] },
          },
        },
      ],
    },
  }),
);
