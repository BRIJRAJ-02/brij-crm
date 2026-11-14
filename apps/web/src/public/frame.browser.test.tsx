// The embed's height follows the page without waiting on an animation frame: Linux WebKit held a framed
// page's `requestAnimationFrame` for about two seconds, so the site's frame kept a booking page's loading
// height after its times had landed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { naturalHeight, watchTree } from './frame.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('watchTree', () => {
  it('reports a change to the tree before any timer, with animation frames held back', async () => {
    // A frame that never comes, as a held one feels to the page.
    vi.stubGlobal('requestAnimationFrame', () => 0);
    const root = document.createElement('div');
    const main = document.createElement('main');
    main.append(document.createElement('section'));
    root.append(main);
    document.body.append(root);
    const changed = vi.fn();
    const stop = watchTree(root, changed);
    // The loading shape gives way to the page's times: one part leaves, another arrives.
    main.firstElementChild?.remove();
    main.append(document.createElement('section'));
    // Mutation records and the call they queue are microtasks: settled before any timer runs.
    await Promise.resolve();
    await Promise.resolve();
    expect(changed).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe('naturalHeight', () => {
  it("counts a part drawn through a display: contents wrapper (the booking page's foot on a phone)", () => {
    // main > layout > [card, foot wrapper (display: contents) > foot]: BookingFrame below the page breakpoint, where the
    // rail's foot card is only a wrapper and its "Powered by" draws under the card (spec 0072, 14 Nov 2026: a booking
    // embed at 320 scrolled 68px inside, the foot left out of its height).
    const main = document.createElement('main');
    main.style.cssText = 'padding: 10px 0';
    const layout = document.createElement('div');
    layout.style.cssText = 'display: flex; flex-direction: column';
    const card = document.createElement('section');
    card.style.cssText = 'block-size: 200px';
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display: contents';
    const foot = document.createElement('footer');
    foot.style.cssText = 'block-size: 68px';
    wrapper.append(foot);
    layout.append(card, wrapper);
    main.append(layout);
    document.body.append(main);
    expect(naturalHeight(main, window)).toBe(10 + 200 + 68 + 10);
  });
});
