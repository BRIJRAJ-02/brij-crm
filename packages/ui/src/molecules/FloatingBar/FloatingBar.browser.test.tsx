// A toast raised from a floating bar (a table's bulk bar) must never sit over the bar's buttons, at a phone's width,
// where the bar spans the window, or a laptop's (a bulk Delete sat under a toast in the trash flow, 13 Nov 2026).
// The story presses Delete, checks the rectangles and presses Delete again; this runs it at each width.
import { composeStories, setProjectAnnotations } from '@storybook/react-vite';
import { afterEach, describe, it } from 'vitest';
import { page } from 'vitest/browser';
import preview from '../../../.storybook/preview.tsx';
import * as FloatingBarStories from './FloatingBar.stories.tsx';

setProjectAnnotations(preview);

const { WithToast } = composeStories(FloatingBarStories);

afterEach(async () => {
  await page.viewport(414, 896);
});

describe('FloatingBar beside a toast', () => {
  it.each([
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
  ])('keeps the toast off the bar at $width wide', async ({ width, height }) => {
    await page.viewport(width, height);
    await WithToast.run();
  });
});
