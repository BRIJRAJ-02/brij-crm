// The embed script in a real page (spec 0062, L3): what it does with the two shapes of booking address, and where
// it puts a second corner button. These run the shipped `apps/web/embed/v1.js` itself, rather than asserting that
// its source contains some words, because the bug this file exists for was a guard that read correctly and
// matched the wrong thing: a booking snippet carrying `handle/slug` was skipped in silence (2 November 2026).
import { afterEach, describe, expect, it } from 'vitest';

const holders: HTMLElement[] = [];

/**
 * Runs the script the way a site does: one tag whose `src` is the file the server actually serves, so
 * `document.currentScript`, ORIGIN and the file's own contents are all the real ones. A fresh query each time,
 * because a second tag of the same address would find `window.Timefix` already there and only rescan.
 */
let runs = 0;
async function run() {
  const tag = document.createElement('script');
  runs += 1;
  tag.src = `/embed/v1.js?run=${runs}`;
  holders.push(tag);
  const ran = new Promise((resolve) => {
    tag.addEventListener('load', resolve);
    tag.addEventListener('error', resolve);
  });
  document.body.appendChild(tag);
  await ran;
}

/** The frame the script drew inside a holder: everything it draws lives in a shadow root of its own. */
function frameIn(holding: HTMLElement) {
  const host = holding.querySelector('div');
  return host?.shadowRoot?.querySelector('iframe') ?? null;
}

/** A holder the script will find on its scan. */
function holder(attributes: Record<string, string>) {
  const element = document.createElement('div');
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  holders.push(element);
  document.body.appendChild(element);
  return element;
}

afterEach(() => {
  for (const element of holders.splice(0)) element.remove();
  for (const host of document.querySelectorAll('div')) if (host.shadowRoot) host.remove();
  delete (window as unknown as { Timefix?: unknown }).Timefix;
});

describe('the embed script', () => {
  it('draws a booking page given as handle and slug, which the page editor is what hands out', async () => {
    const holding = holder({ 'data-timefix-booking': 'ada/intro' });
    await run();
    const frame = frameIn(holding);
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('src')).toContain('/ada/intro');
  });

  it('still draws a booking page given as its own key', async () => {
    const holding = holder({ 'data-timefix-booking': 'abcdefghijklmnop' });
    await run();
    expect(frameIn(holding)?.getAttribute('src')).toContain('/b/abcdefghijklmnop');
  });

  it('skips an address that is neither, and says so rather than failing silently', async () => {
    const warnings: string[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(String(args[0]));
    const holding = holder({ 'data-timefix-booking': 'not a key at all' });
    await run();
    console.warn = warn;
    expect(frameIn(holding)).toBeNull();
    expect(warnings.some((line) => line.includes('not a key at all'))).toBe(true);
  });

  it('lifts a second corner button clear of the first instead of stacking them', async () => {
    holder({ 'data-timefix-form': 'graphic-designer', 'data-timefix-mode': 'floating' });
    holder({ 'data-timefix-booking': 'ada/intro', 'data-timefix-mode': 'floating' });
    await run();
    const lifts = [...document.querySelectorAll('div')]
      .map((host) => host.shadowRoot?.querySelector('button.fab'))
      .filter((button): button is HTMLElement => button instanceof HTMLElement)
      .map((button) => button.style.getPropertyValue('--tfx-lift'));
    expect(lifts).toHaveLength(2);
    expect(new Set(lifts).size).toBe(2);
    expect(lifts).toContain('0px');
  });
});
