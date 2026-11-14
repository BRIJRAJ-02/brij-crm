// The screenshot harness waits for a theme swap's colour transitions before it shoots. A transition on a colour a
// child inherits restarts the child's own transition every frame, and each restart cancels the one before, whose
// `finished` then rejects with an AbortError (the DataGrid header's colour over its menu Button, the Sidebar row's over
// its grip, 14 Nov 2026). A cancelled transition has been replaced, not failed, so the wait has to ride it out.
import { afterEach, describe, expect, it } from 'vitest';
import { waitForAnimations } from './animations.ts';

afterEach(() => {
  document.getElementById('fixture')?.remove();
});

/** Reads the element's style, so the change after it is a change from this value (a style change event). */
function restyle(element: Element): string {
  return getComputedStyle(element).color;
}

/** A parent that tweens its colour over a child that inherits it and tweens its own. */
function mountNested(): HTMLElement {
  const host = document.createElement('div');
  host.id = 'fixture';
  const parent = document.createElement('div');
  parent.style.cssText = 'color: rgb(0, 0, 0); transition: color 200ms linear';
  const child = document.createElement('button');
  child.style.cssText = 'color: inherit; transition: color 200ms linear';
  child.textContent = 'Menu';
  parent.append(child);
  host.append(parent);
  document.body.append(host);
  restyle(child);
  parent.style.color = 'rgb(255, 255, 255)';
  restyle(child);
  return child;
}

describe('waitForAnimations', () => {
  it('waits out a transition that its parent cancels and restarts, and ends on the settled colour', async () => {
    const child = mountNested();
    expect(document.getAnimations().length).toBeGreaterThan(0);
    await waitForAnimations();
    expect(document.getAnimations()).toHaveLength(0);
    expect(getComputedStyle(child).color).toBe('rgb(255, 255, 255)');
  });

  it('rides out a transition replaced while it waits, whose finished rejects with an AbortError', async () => {
    const child = mountNested();
    const first = document.getAnimations();
    const settled = waitForAnimations();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    // A new end value mid flight (the theme's value moving again) cancels the running transitions and starts new ones.
    child.parentElement?.style.setProperty('color', 'rgb(0, 0, 255)');
    child.style.setProperty('color', 'rgb(0, 128, 0)');
    restyle(child);
    await expect(Promise.all(first.map((animation) => animation.finished))).rejects.toThrow(/abort/i);
    await settled;
    expect(document.getAnimations()).toHaveLength(0);
    expect(getComputedStyle(child).color).toBe('rgb(0, 128, 0)');
  });

  it('leaves an endless animation running and does not wait on it', async () => {
    const host = document.createElement('div');
    host.id = 'fixture';
    document.body.append(host);
    const spinner = host.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 100, iterations: Infinity });
    await waitForAnimations();
    expect(spinner.playState).toBe('running');
  });
});
