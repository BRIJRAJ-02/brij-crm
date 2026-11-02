// Put it on your site, in Chromium (spec 0062, L3): the snippet follows the choices, the options that only make
// sense for a dialog or a corner button appear with them, a page that isn't live hands out no snippet, and no axe
// violations in either theme.
import '@crm/ui/styles.css';
import { BRAND_QUICK_PICKS } from '@crm/data';
import { PageColumn } from '@crm/ui';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { EmbedCard } from './EmbedCard.tsx';

const SCRIPT = 'https://app.timefix.com/embed/v1.js';

let shown: InApp | undefined;
afterEach(() => {
  shown?.unmount();
  shown = undefined;
  resetTheme();
});

async function show(isLive = true) {
  shown = await renderInApp(
    () => (
      <PageColumn>
        <EmbedCard
          script={SCRIPT}
          publicKey="ada/intro"
          title="Intro call"
          isLive={isLive}
          quickPicks={BRAND_QUICK_PICKS}
        />
      </PageColumn>
    ),
    // The card reads nothing from the data layer: its choices are local and the snippet is built from its props.
    { data: {}, pattern: '/w/$slug/bookings/links/$id', at: '/w/acme/bookings/links/one' },
  );
}

/**
 * The tiles and the segmented track animate, so a plain click waits for a stability that never arrives: the words
 * are clicked with `force`, as the form's Install tab test does.
 */

/** The quick setups, which the card opens on; the same names appear again inside Change the details. */
const setups = () => page.getByRole('radiogroup', { name: 'Pick one' });

/** Opens the fold where the two underlying choices live. */
const openDetails = () => userEvent.click(page.getByRole('button', { name: 'Change the details' }));

/** What the Snippet field holds now. */
const snippet = () => (page.getByRole('textbox', { name: 'Snippet' }).element() as HTMLTextAreaElement).value;

describe('Put it on your site', () => {
  it('starts on the corner button, and names the page by its handle address', async () => {
    await show();
    const code = snippet();
    expect(code).toContain(`<script src="${SCRIPT}" async></script>`);
    expect(code).toContain('data-timefix-booking="ada/intro"');
    expect(code).toContain('data-timefix-mode="floating"');
    // The middle is the default, so an older snippet and a new one mean the same thing.
    expect(code).not.toContain('data-timefix-panel');
  });

  it('writes the side panel once it is picked, and takes it away again', async () => {
    await show();
    await userEvent.click(setups().getByText('Side panel', { exact: true }), { force: true });
    expect(snippet()).toContain('data-timefix-panel="side"');
    await userEvent.click(setups().getByText('Corner button', { exact: true }), { force: true });
    expect(snippet()).not.toContain('data-timefix-panel');
  });

  it('offers the colour and the mark for the corner button alone', async () => {
    await show();
    // The corner button is the first setup, so its own look is offered from the start.
    await expect.element(page.getByRole('radio', { name: 'Timefix' })).toBeVisible();
    expect(snippet()).toContain('data-timefix-icon="calendar"');
    // Your own button: its words still, but nothing of ours to colour or mark.
    await userEvent.click(setups().getByText('Your own button', { exact: true }), { force: true });
    await expect.element(page.getByRole('textbox', { name: 'Button words' })).toBeVisible();
    expect(page.getByRole('radio', { name: 'Timefix' }).query()).toBeNull();
    const code = snippet();
    expect(code).toContain('data-timefix-mode="popup"');
    expect(code).not.toContain('data-timefix-icon');
  });

  it('puts nothing in the page but the holder, and no button words, for an inline embed', async () => {
    await show();
    await userEvent.click(setups().getByText('In the page', { exact: true }), { force: true });
    expect(page.getByRole('textbox', { name: 'Button words' }).query()).toBeNull();
    const code = snippet();
    expect(code).toContain('data-timefix-booking="ada/intro"');
    expect(code).not.toContain('data-timefix-mode');
  });

  it('carries the words that were typed, escaped, so a quote can never end the attribute', async () => {
    await show();
    await userEvent.fill(page.getByRole('textbox', { name: 'Button words' }), 'Book "now"');
    const code = snippet();
    expect(code).toContain('Book &quot;now&quot;');
    expect(code).not.toContain('Book "now"');
  });

  it('hands out no snippet for a page that is not live yet, and says why', async () => {
    await show(false);
    expect(snippet()).toBe('');
    await expect.element(page.getByText('Publish the page to get its snippet.')).toBeVisible();
  });

  it('keeps the setup and the details the same two choices, not two states', async () => {
    await show();
    await openDetails();
    const details = page.getByRole('radiogroup', { name: 'How it opens' });
    // The fold opens showing what the chosen setup set, rather than its own untouched defaults.
    await expect.element(details.getByRole('radio', { name: /A corner button/ })).toBeChecked();
    await expect.element(page.getByRole('radio', { name: 'Middle' })).toBeChecked();
    // Changing it there moves the setup above, since there is one state underneath.
    await userEvent.click(page.getByText('Side panel', { exact: true }).first(), { force: true });
    await expect.element(setups().getByRole('radio', { name: /Side panel/ })).toBeChecked();
    expect(snippet()).toContain('data-timefix-panel="side"');
  });

  for (const theme of THEMES) {
    it(`has no axe violations in ${theme}`, async () => {
      await show();
      await userEvent.click(setups().getByText('Corner button', { exact: true }), { force: true });
      applyTheme(theme);
      expect(await axeViolations()).toEqual([]);
    });
  }
});
