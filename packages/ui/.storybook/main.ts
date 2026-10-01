// Storybook for the component library: every state is a story, and the same
// stories run as browser tests (vitest.config.ts) and become the artifact's
// previews. Vite settings come from ../vite.config.ts, which loads uiVite().
import type { StorybookConfig } from '@storybook/react-vite';

/** The nonce Vite's own injected styles carry in tests. Anything else that injects a <style> breaks the policy. */
const TEST_NONCE = 'crm-story-tests';

// The production rules a component could break (spec 0003): no injected
// styles, images only from our origin, data: or blob:, workers and frames from
// our origin only. script-src is left out, since the test runner needs it.
const TEST_POLICY = [
  `style-src 'self' 'nonce-${TEST_NONCE}'`,
  "img-src 'self' data: blob:",
  "worker-src 'self'",
  "frame-src 'self'",
].join('; ');

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.tsx'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y', '@storybook/addon-vitest', '@storybook/addon-mcp'],
  core: { disableTelemetry: true },
  // Only under Vitest: the policy would also block Storybook's own docs styles.
  previewHead: (head) =>
    process.env.VITEST === undefined
      ? head
      : `${head}<meta property="csp-nonce" nonce="${TEST_NONCE}"><meta http-equiv="Content-Security-Policy" content="${TEST_POLICY}">`,
};

export default config;
