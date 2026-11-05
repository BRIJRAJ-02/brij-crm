// The web app's test projects:
//   node     the middleware, the built page, the first load and pure helpers (*.test.ts)
//   browser  what needs a real page: the Sentry SDK in Chromium (*.browser.test.tsx)
import { playwright } from '@vitest/browser-playwright';
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    // The phone field's library loads on demand from @crm/ui. Bundled up front, so the browser tests' server
    // never finds it halfway through a run and reloads the page under them.
    optimizeDeps: {
      include: ['@crm/ui > libphonenumber-js/max', '@crm/ui > libphonenumber-js/mobile/examples'],
    },
    plugins: [
      {
        // No api runs behind these tests. A `<link rel="stylesheet" precedence>` that fails rejects a promise React
        // keeps to itself (`link._p`, with the error Event as its reason), which nothing can catch and which fails the
        // run with `stack: 'undefined'`. So the Menus editor's look answers here, as an empty stylesheet.
        name: 'crm:menu-look-for-tests',
        configureServer(server) {
          server.middlewares.use('/api/menu/look.css', (_request, response) => {
            response.setHeader('content-type', 'text/css');
            response.end('');
          });
        },
      },
    ],
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
