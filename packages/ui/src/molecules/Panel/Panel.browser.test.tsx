// The record panel's motion in Chromium (spec 0074, AC-7411): it slides in over duration-slow and leaves quicker than it
// came, over the house's exit token, duration-quick, as a Modal's drawer and the sheet Panel do. A leave as slow as its
// entry kept a closed record in view for a third of a second (the phase 3 review). Reduced motion keeps only the fade.
// The library's layers first, as every page loads them: a module's CSS loaded ahead would declare its layer first.
import '../../styles/index.css';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { createToasts } from '../../provider/toasts.tsx';
import { UiProvider } from '../../provider/UiProvider.tsx';
import { Panel } from './Panel.tsx';

let host: HTMLElement;
let view: Root | undefined;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  view = createRoot(host);
});

afterEach(async () => {
  act(() => {
    view?.unmount();
  });
  host.remove();
  await commands.emulateReducedMotion(false);
});

/** The floating panel, open or closing. */
function draw(isOpen: boolean) {
  act(() => {
    view?.render(
      <UiProvider locale="en-GB" timeZone="Europe/London" toasts={createToasts()} navigate={() => undefined}>
        <Panel title="Northwind Traders" variant="floating" isOpen={isOpen} onClose={() => undefined}>
          {null}
        </Panel>
      </UiProvider>,
    );
  });
}

/** Opens the panel as a click does: opened from the keyboard it appears at once, with no motion to measure. */
async function openByPointer() {
  await userEvent.click(page.elementLocator(document.body));
  draw(true);
}

/** A duration token's value in milliseconds, as the page resolves it. */
function tokenMs(name: string) {
  const probe = document.createElement('div');
  probe.style.transitionDuration = `var(${name})`;
  document.body.append(probe);
  const value = getComputedStyle(probe).transitionDuration;
  probe.remove();
  return msOf(value);
}

/** A computed duration (`0.15s` or `150ms`) in milliseconds. */
function msOf(value: string) {
  return value.endsWith('ms') ? Number.parseFloat(value) : Number.parseFloat(value) * 1000;
}

/** The panel's section and its computed animation. */
function panelAnimation() {
  const panel = host.ownerDocument.querySelector('section[data-variant="floating"]');
  if (panel === null) throw new Error('no floating panel drawn');
  const style = getComputedStyle(panel);
  return { panel, name: style.animationName, ms: msOf(style.animationDuration) };
}

describe('the record panel’s motion', () => {
  it('enters over duration-slow and leaves over duration-quick, quicker than it came', async () => {
    await openByPointer();
    const entry = panelAnimation();
    expect(entry.panel.hasAttribute('data-entering')).toBe(true);
    expect(entry.ms).toBe(tokenMs('--duration-slow'));
    draw(false);
    const exit = panelAnimation();
    expect(exit.panel.hasAttribute('data-exiting')).toBe(true);
    expect(exit.name).toMatch(/slide-out$/);
    expect(exit.ms).toBe(tokenMs('--duration-quick'));
    expect(exit.ms).toBeLessThan(entry.ms);
  });

  it('keeps only the fade, at the same quick exit, under reduced motion', async () => {
    await commands.emulateReducedMotion(true);
    await openByPointer();
    expect(panelAnimation().name).toMatch(/fade-in$/);
    draw(false);
    const exit = panelAnimation();
    expect(exit.name).toMatch(/fade-out$/);
    expect(exit.ms).toBe(tokenMs('--duration-quick'));
  });
});
