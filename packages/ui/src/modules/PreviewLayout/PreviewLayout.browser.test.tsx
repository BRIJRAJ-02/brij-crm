// The preview phone's page (PreviewFrame) with real input, which a story's
// synthetic events can't give: a wheel over the phone reaches the page through
// its inert frame and scrolls it down to its "Powered by" foot, and with
// reduced motion the keys move it at once. Chromium only, as this project is.
import { composeStories, setProjectAnnotations } from '@storybook/react-vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import preview from '../../../.storybook/preview.tsx';
import * as stories from './PreviewLayout.stories.tsx';

setProjectAnnotations(preview);

const { LongPage } = composeStories(stories);

/** The story, played (it ends at the page's top): the screen's region, the page's window, and its foot's distance under the screen. */
async function longPage() {
  await LongPage.run();
  const region = page.getByRole('region', { name: 'Phone preview' });
  const frame = document.querySelector('iframe');
  const view = frame?.contentWindow;
  const foot = frame?.contentDocument?.getElementById('foot');
  if (view === null || view === undefined || foot === null || foot === undefined) throw new Error('no long page');
  return { region, view, footBelow: () => foot.getBoundingClientRect().bottom - view.innerHeight };
}

describe('a page longer than the preview phone', () => {
  beforeAll(async () => {
    // The stories' window, so the phone sits beside the body rather than behind the Preview button.
    await page.viewport(1200, 900);
  });

  it('scrolls by a wheel over the phone, through the inert frame', async () => {
    const { region, view, footBelow } = await longPage();
    await expect.element(region).toBeVisible();
    expect(view.scrollY).toBe(0);
    await userEvent.wheel(region, { delta: { y: 300 } });
    await expect.poll(() => view.scrollY).toBeGreaterThan(0);
    // On down to its foot, "Powered by" and all.
    await userEvent.wheel(region, { delta: { y: 400 }, times: 12 });
    await expect.poll(footBelow).toBeLessThanOrEqual(0);
  });

  describe('with reduced motion', () => {
    beforeAll(async () => {
      await commands.emulateReducedMotion(true);
    });
    afterAll(async () => {
      await commands.emulateReducedMotion(false);
    });

    it('moves at once on the keys, with no glide', async () => {
      const { region, view, footBelow } = await longPage();
      expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true);
      await userEvent.click(region);
      await userEvent.keyboard('{End}');
      expect(footBelow()).toBeLessThanOrEqual(0);
      await userEvent.keyboard('{Home}');
      expect(view.scrollY).toBe(0);
    });
  });
});
