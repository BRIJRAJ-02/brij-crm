// The library's test projects:
//   unit     pure helpers in Node (*.test.ts)
//   stories  every story as a browser test in Chromium, Firefox and WebKit,
//            with its play script, axe in light and dark, and the CSP check
//   browser  browser tests that aren't one story (*.browser.test.tsx):
//            forced colours, timing hooks; Chromium only
//   visual   screenshots of every story in light and dark, Chromium only, run
//            inside the pinned Playwright Linux image (`pnpm test:visual`)
// `pnpm --filter @crm/ui test` runs unit, stories and browser.
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import path from 'node:path';
import { defineConfig, mergeConfig } from 'vitest/config';
import type { BrowserCommand } from 'vitest/node';
import viteConfig from './vite.config.ts';

const ROOT = import.meta.dirname;
const STORYBOOK = path.join(ROOT, '.storybook');

/** Switches forced colours (Windows high contrast) on or off for the page. Vitest's page can't, Playwright can. */
const emulateForcedColors: BrowserCommand<[active: boolean]> = async (context, active) => {
  await context.page.emulateMedia({ forcedColors: active ? 'active' : 'none' });
};

const headless = { enabled: true, headless: true, provider: playwright() } as const;

/**
 * The engines the stories run in: all three by default. CI runs each engine
 * as its own job (CRM_STORY_BROWSERS=firefox), and `none` leaves the stories
 * out of the main test job.
 */
const STORY_BROWSERS = (process.env.CRM_STORY_BROWSERS ?? 'chromium,firefox,webkit')
  .split(',')
  .map((name) => name.trim())
  .filter((name): name is 'chromium' | 'firefox' | 'webkit' => ['chromium', 'firefox', 'webkit'].includes(name));

/** `Button.stories.tsx`, `With Shortcut`, `light` → `Button/With-Shortcut-light-linux.png`. */
function screenshotName(testFileName: string, testName: string, arg: string, platform: string, ext: string): string {
  const component = path.basename(testFileName).replace(/\.stories\.tsx$/, '');
  return path.join(component, `${testName.replaceAll(/[^\w-]+/g, '-')}-${arg}-${platform}${ext}`);
}

export default mergeConfig(
  viteConfig,
  defineConfig({
    // React Aria's Virtualizer draws every row when NODE_ENV is "test", unless
    // VIRT_ON is set. Set it, so stories virtualise as the app does.
    define: { 'process.env.VIRT_ON': JSON.stringify('1') },
    test: {
      projects: [
        {
          extends: true,
          test: { name: 'unit', environment: 'node', include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'] },
        },
        ...(STORY_BROWSERS.length === 0
          ? []
          : [
              {
                extends: true,
                plugins: [storybookTest({ configDir: STORYBOOK })],
                test: {
                  name: 'stories',
                  // One file at a time per browser: files share one page, so focus, the
                  // pointer and emulated media would leak between them.
                  fileParallelism: false,
                  // With three engines on one CI machine, a pointer move now and then
                  // lands before the page is ready for it. A real bug fails every try.
                  retry: process.env.CI === undefined ? 0 : 2,
                  setupFiles: [path.join(STORYBOOK, 'vitest.announcer.ts'), path.join(STORYBOOK, 'vitest.setup.ts')],
                  browser: {
                    ...headless,
                    instances: STORY_BROWSERS.map((browser) => ({ browser })),
                  },
                },
              },
            ]),
        {
          // The 100,000 row test (AC-7) on React's production build, as people
          // get it: the development build is several times slower.
          extends: true,
          mode: 'production',
          define: { 'process.env.NODE_ENV': JSON.stringify('production'), 'process.env.VIRT_ON': 'undefined' },
          resolve: { alias: { 'react/jsx-dev-runtime': path.join(ROOT, 'scripts/jsx-dev-runtime.ts') } },
          test: {
            name: 'perf',
            include: ['src/**/*.perf.test.tsx'],
            retry: 1,
            browser: { ...headless, instances: [{ browser: 'chromium' }], viewport: { width: 1280, height: 800 } },
          },
        },
        {
          extends: true,
          test: {
            name: 'browser',
            fileParallelism: false,
            include: ['src/**/*.browser.test.tsx'],
            browser: { ...headless, instances: [{ browser: 'chromium' }], commands: { emulateForcedColors } },
          },
        },
        {
          extends: true,
          plugins: [storybookTest({ configDir: STORYBOOK })],
          test: {
            name: 'visual',
            fileParallelism: false,
            retry: process.env.CI === undefined ? 0 : 2,
            setupFiles: [path.join(STORYBOOK, 'vitest.announcer.ts'), path.join(STORYBOOK, 'vitest.visual.ts')],
            provide: { visualImage: process.env.CRM_VISUAL_IMAGE === '1' },
            browser: {
              ...headless,
              instances: [{ browser: 'chromium' }],
              viewport: { width: 1200, height: 900 },
              expect: {
                toMatchScreenshot: {
                  // packages/ui/__screenshots__/<Component>/<story>-<theme>-linux.png
                  resolveScreenshotPath: ({ testFileName, testName, arg, platform, ext }) =>
                    path.join(ROOT, '__screenshots__', screenshotName(testFileName, testName, arg, platform, ext)),
                  // A failed run's actual and diff images, per story: .vitest/attachments/<Component>/…
                  resolveDiffPath: ({ testFileName, testName, arg, platform, ext }) =>
                    path.join(
                      ROOT,
                      '.vitest',
                      'attachments',
                      screenshotName(testFileName, testName, arg, platform, ext),
                    ),
                  screenshotOptions: { animations: 'disabled', caret: 'hide' },
                },
              },
            },
          },
        },
      ],
    },
  }),
);

declare module 'vitest' {
  export interface ProvidedContext {
    /** True only inside the pinned Playwright image, where screenshots are comparable. */
    visualImage: boolean;
  }
}

declare module 'vitest/browser' {
  interface BrowserCommands {
    emulateForcedColors: (active: boolean) => Promise<void>;
  }
}
