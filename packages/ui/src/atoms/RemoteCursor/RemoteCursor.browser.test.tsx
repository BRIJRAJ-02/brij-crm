// RemoteCursor's pointer under reduced motion (spec 0073, AC-7309): it jumps to each point rather than gliding, and
// idle keeps its fade without the pill's shrink. A story can't switch the media itself, so this runs the Pointers
// story with Playwright emulating it; the story asserts each branch. Chromium only, as this project is.
import { composeStories, setProjectAnnotations } from '@storybook/react-vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import preview from '../../../.storybook/preview.tsx';
import * as stories from './RemoteCursor.stories.tsx';

setProjectAnnotations(preview);

const { Pointers } = composeStories(stories);

describe('RemoteCursor pointers with reduced motion', () => {
  beforeAll(async () => {
    await commands.emulateReducedMotion(true);
  });
  afterAll(async () => {
    await commands.emulateReducedMotion(false);
  });

  it('jumps to each point and keeps the idle fade', async () => {
    expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true);
    await Pointers.run();
    const pointer = document.querySelector('[data-hue="purple"]');
    if (!(pointer instanceof HTMLElement)) throw new Error('no pointer');
    expect(getComputedStyle(pointer).transitionDuration).toBe('0s');
  });
});
