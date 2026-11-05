// The embed's height follows the page without waiting on an animation frame: Linux WebKit held a framed
// page's `requestAnimationFrame` for about two seconds, so the site's frame kept a booking page's loading
// height after its times had landed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchTree } from './frame.ts';

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
