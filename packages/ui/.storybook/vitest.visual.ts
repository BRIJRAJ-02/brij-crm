// Runs after every story in the `visual` project (Chromium, inside the pinned
// Playwright Linux image): one screenshot of the story frame in light and one
// in dark, compared with the committed baselines (AC-16). A story opts out
// with `parameters.crm.screenshot = false` when another story shows the same.
import { configure } from 'storybook/test';
import { afterEach, beforeAll, expect, inject } from 'vitest';
import { page } from 'vitest/browser';

// The same waits as the story tests: hover and focus can take a moment in CI.
configure({ asyncUtilTimeout: 5_000 });

interface StoryContext {
  readonly story?: { readonly parameters: { readonly crm?: { readonly screenshot?: boolean } } };
}

// Fonts and anti aliasing differ by platform, so baselines come from one image.
beforeAll(() => {
  if (!inject('visualImage')) {
    throw new Error(
      'Screenshots run only in the pinned Playwright Linux image. Run `pnpm test:visual` (it uses Docker).',
    );
  }
});

afterEach(async (context) => {
  const story = (context as StoryContext).story;
  if (story === undefined || story.parameters.crm?.screenshot === false) return;

  await document.fonts.ready;
  const html = document.documentElement;
  const theme = html.dataset.theme;
  try {
    for (const name of ['light', 'dark'] as const) {
      html.dataset.theme = name;
      await expect.element(page.getByTestId('story-root')).toMatchScreenshot(name);
    }
  } finally {
    if (theme === undefined) delete html.dataset.theme;
    else html.dataset.theme = theme;
  }
});
