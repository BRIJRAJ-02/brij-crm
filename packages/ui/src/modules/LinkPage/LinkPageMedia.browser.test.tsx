// The media facade (spec 0061, AC-6106, AC-6127): nothing from the provider until Play, then the player in the very
// same box with focus inside it, its address only ever on that provider's player origin. In a real browser, since
// the box sizes and focus are what is being proved; the stories can't press Play (their policy allows no frame).
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import '../../styles/index.css';
import { createToasts } from '../../provider/toasts.tsx';
import { UiProvider } from '../../provider/UiProvider.tsx';
import type { LinkPageBlock } from './LinkPage.tsx';
import { LinkPageMedia, playerSrc } from './LinkPageMedia.tsx';

const VIDEO: Extract<LinkPageBlock, { kind: 'media' }> = {
  kind: 'media',
  id: 'talk',
  provider: 'youtube',
  title: 'Scheduling that books itself',
  frame: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0',
};

let root: Root | undefined;
let host: HTMLDivElement | undefined;

async function draw(block: Extract<LinkPageBlock, { kind: 'media' }>, onPress?: () => void) {
  host = document.createElement('div');
  host.setAttribute('style', 'inline-size: 400px');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <UiProvider locale="en-GB" timeZone="Europe/London" toasts={createToasts()} navigate={() => undefined}>
        <LinkPageMedia block={block} isTile={false} {...(onPress === undefined ? {} : { onPress })} />
      </UiProvider>,
    );
    await Promise.resolve();
  });
  return host;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = undefined;
  host = undefined;
});

describe('the media facade', () => {
  it('loads nothing from the provider until Play, then swaps the player in at the same size with focus inside', async () => {
    let pressed = 0;
    const drawn = await draw(VIDEO, () => {
      pressed += 1;
    });
    expect(drawn.querySelector('iframe')).toBeNull();
    // Every address the facade draws is our own (no poster here, so none at all).
    for (const image of drawn.querySelectorAll('img')) expect(image.src.startsWith(location.origin)).toBe(true);
    expect(drawn.textContent).toContain('Plays from YouTube');
    const play = drawn.querySelector('button');
    if (play === null) throw new Error('No Play button');
    expect(play.getAttribute('aria-label')).toBe(`Play ${VIDEO.title}`);
    const poster = play.closest('[role="presentation"]');
    if (poster === null) throw new Error('No poster');
    const before = poster.getBoundingClientRect();
    await act(async () => {
      play.click();
      await Promise.resolve();
    });
    const frame = drawn.querySelector('iframe');
    if (frame === null) throw new Error('No player');
    expect(frame.getAttribute('src')).toBe(VIDEO.frame);
    expect(frame.title).toBe(VIDEO.title);
    const after = frame.getBoundingClientRect();
    expect(Math.round(after.width)).toBe(Math.round(before.width));
    expect(Math.round(after.height)).toBe(Math.round(before.height));
    expect(document.activeElement).toBe(frame);
    expect(pressed).toBe(1);
  });

  it('never makes a frame of an address off the provider’s own player origin', async () => {
    expect(playerSrc('youtube', 'https://www.youtube.com/embed/x')).toBeUndefined();
    expect(playerSrc('youtube', 'http://www.youtube-nocookie.com/embed/x')).toBeUndefined();
    expect(playerSrc('spotify', 'https://www.youtube-nocookie.com/embed/x')).toBeUndefined();
    expect(playerSrc('vimeo', 'javascript:alert(1)')).toBeUndefined();
    expect(playerSrc('spotify', 'https://open.spotify.com/embed/track/1')).toBe(
      'https://open.spotify.com/embed/track/1',
    );
    const drawn = await draw({ ...VIDEO, frame: 'https://evil.example/embed/x' });
    // No dead Play: no button at all, and the caption says it can't play here.
    expect(drawn.querySelector('button')).toBeNull();
    expect(drawn.textContent).toContain('Can’t play here');
    expect(drawn.querySelector('iframe')).toBeNull();
  });
});
