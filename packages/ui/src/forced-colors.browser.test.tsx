// AC-6: every interactive component shows its focus ring in forced colours
// (Windows high contrast), where box shadows are dropped. Each component's
// keyboard focus story runs with forced colours on, and the focused element
// must draw a real outline. Chromium only: Playwright emulates the media.
import { composeStories, setProjectAnnotations } from '@storybook/react-vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import preview from '../.storybook/preview.tsx';
import * as ButtonStories from './atoms/Button/Button.stories.tsx';

setProjectAnnotations(preview);

/** The story per interactive component whose play leaves keyboard focus on it. */
const FOCUS_STORIES = {
  Button: composeStories(ButtonStories).Focused,
};

describe('forced colours', () => {
  beforeAll(async () => {
    await commands.emulateForcedColors(true);
  });
  afterAll(async () => {
    await commands.emulateForcedColors(false);
  });

  it('is on for these tests', () => {
    expect(matchMedia('(forced-colors: active)').matches).toBe(true);
  });

  it.each(Object.entries(FOCUS_STORIES))('%s draws an outline on keyboard focus', async (_name, Story) => {
    await Story.run();
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement)) throw new Error('the story left nothing focused');
    const style = getComputedStyle(focused);
    expect(style.outlineStyle).not.toBe('none');
    expect(Number.parseFloat(style.outlineWidth)).toBeGreaterThanOrEqual(2);
  });
});
