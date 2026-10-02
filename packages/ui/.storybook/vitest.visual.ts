// Runs after every story in the `visual` project (Chromium, inside the pinned
// Playwright Linux image): one screenshot of the story frame in light and one
// in dark, compared with the committed baselines (AC-16). A story opts out
// with `parameters.crm.screenshot = false` when another story shows the same.
// Menus, popovers, dialogs and tooltips open in a portal outside the story
// frame, and a floating panel is fixed to the viewport, so while one is open
// the frame grows to the viewport and the screenshot takes it in.
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

/**
 * Something drawn outside the story frame, such as an open menu or dialog:
 * React Aria portals them straight into the body. Storybook's own wrappers
 * there have no size, its a11y addon adds an svg of filters that paints
 * nothing, and visually hidden nodes (the live announcer) are a pixel square,
 * so only an HTML element with a box larger than that counts.
 */
function hasOverlay(root: Element): boolean {
  const isDrawn = (element: Element) => {
    const box = element.getBoundingClientRect();
    return box.width > 1 && box.height > 1;
  };
  const portalled = Array.from(document.body.children).some(
    (element) => element instanceof HTMLElement && !element.contains(root) && isDrawn(element),
  );
  // A floating panel stays in the story, fixed to the viewport rather than the frame.
  const fixed = Array.from(root.querySelectorAll('*')).some(
    (element) => getComputedStyle(element).position === 'fixed' && isDrawn(element),
  );
  return portalled || fixed;
}

afterEach(async (context) => {
  const story = (context as StoryContext).story;
  if (story === undefined || story.parameters.crm?.screenshot === false) return;

  await document.fonts.ready;
  const html = document.documentElement;
  const theme = html.dataset.theme;
  const root = document.querySelector<HTMLElement>('[data-testid="story-root"]');
  // The frame is as tall as its story; while an overlay is open it fills the
  // viewport, so the screenshot's clip takes in the overlay too.
  if (root !== null && hasOverlay(root)) root.style.minBlockSize = '100dvb';
  try {
    for (const name of ['light', 'dark'] as const) {
      html.dataset.theme = name;
      await expect.element(page.getByTestId('story-root')).toMatchScreenshot(name);
    }
  } finally {
    if (theme === undefined) delete html.dataset.theme;
    else html.dataset.theme = theme;
    root?.style.removeProperty('min-block-size');
  }
});
