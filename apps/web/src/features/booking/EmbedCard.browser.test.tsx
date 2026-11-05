// Put it on your site, in Chromium (spec 0062, L3): the snippet follows the choices, the options that only make
// sense for a dialog or a corner button appear with them, a page that isn't live hands out no snippet, and no axe
// violations in either theme.
import '@crm/ui/styles.css';
import { BRAND_QUICK_PICKS } from '@crm/data';
import { BookingPagePicture, PageColumn } from '@crm/ui';
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
          picture={
            <BookingPagePicture
              title="Intro call"
              lengths="30 min"
              openDays={[true, true, true, true, true, false, false]}
              hue="blue"
            />
          }
        />
      </PageColumn>
    ),
    // The card reads nothing from the data layer: its choices are local and the snippet is built from its props.
    { data: {}, pattern: '/w/$slug/bookings/links/$id', at: '/w/acme/bookings/links/one' },
  );
}

/**
 * The tiles animate, so a plain click waits for a stability that never arrives: the words are clicked with
 * `force`, as the form's Install tab test does.
 */
const pick = (name: string) =>
  userEvent.click(page.getByRole('radiogroup', { name: 'How it opens' }).getByText(name, { exact: true }), {
    force: true,
  });

/** What the Embed snippet field holds now (named as the form's is, 5 November 2026). */
const snippet = () => (page.getByRole('textbox', { name: 'Embed snippet' }).element() as HTMLTextAreaElement).value;

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

  it('writes the side panel once the switch is on, and takes it away again', async () => {
    await show();
    // The switch's knob slides, so like the tiles it never reports itself stable: pressed with `force`.
    const slide = page.getByRole('switch', { name: 'Slide in from the side' });
    await userEvent.click(slide, { force: true });
    expect(snippet()).toContain('data-timefix-panel="side"');
    await userEvent.click(slide, { force: true });
    expect(snippet()).not.toContain('data-timefix-panel');
  });

  it('keeps the side switch for a button of the site’s own, and drops it in the page', async () => {
    await show();
    // Popup: the site's own button opens it (the form's Share tab's name for it, 5 November 2026).
    await pick('Popup');
    await expect.element(page.getByRole('switch', { name: 'Slide in from the side' })).toBeVisible();
    await pick('In the page');
    expect(page.getByRole('switch', { name: 'Slide in from the side' }).query()).toBeNull();
  });

  it('offers the colour and the mark for the corner button alone', async () => {
    await show();
    // The corner button is the first answer, so its own look is offered from the start.
    await expect.element(page.getByRole('radio', { name: 'Timefix' })).toBeVisible();
    expect(snippet()).toContain('data-timefix-icon="calendar"');
    // Popup, the site's own button: its words still, but nothing of ours to colour or mark.
    await pick('Popup');
    await expect.element(page.getByRole('textbox', { name: 'Button words' })).toBeVisible();
    expect(page.getByRole('radio', { name: 'Timefix' }).query()).toBeNull();
    const code = snippet();
    expect(code).toContain('data-timefix-mode="popup"');
    expect(code).not.toContain('data-timefix-icon');
  });

  it('puts nothing in the page but the holder, and no button words, for an inline embed', async () => {
    await show();
    await pick('In the page');
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

  it('says what each way does on its tile, and shows the pick on a made up site', async () => {
    await show();
    await expect.element(page.getByText('A button in the corner opens it.')).toBeVisible();
    await expect.element(page.getByRole('img', { name: 'How the booking page sits on your site' })).toBeVisible();
    // The mark is a choice of the corner button's own, and writes what it says.
    await userEvent.click(page.getByRole('radio', { name: 'Mail' }), { force: true });
    expect(snippet()).toContain('data-timefix-icon="mail"');
    await userEvent.click(page.getByRole('radio', { name: 'None' }), { force: true });
    expect(snippet()).not.toContain('data-timefix-icon');
  });

  it('hands out no snippet for a page that is not live yet, and says why', async () => {
    await show(false);
    expect(snippet()).toBe('');
    await expect.element(page.getByText('Publish the page to get its snippet.')).toBeVisible();
  });

  for (const theme of THEMES) {
    it(`has no axe violations in ${theme}`, async () => {
      await show();
      applyTheme(theme);
      expect(await axeViolations()).toEqual([]);
    });
  }
});
