// A form's Share tab in Chromium (spec 0058, AC-11; T44): the link block the live dialog uses, then the three ways a
// site shows the form as tiles beside a made up site that shows the pick, its words and look rewriting the snippet,
// and the developer material in one quiet sheet. The tokens, so sizes measured below are the real ones.
import '@crm/ui/app.css';
import type { DataLayer, FormDocument, FormView } from '@crm/data';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { ShareTab } from './ShareTab.tsx';

const DOCUMENT: FormDocument = {
  questions: [
    { id: 'q-email', key: 'email', label: 'Work email', answerType: 'email', required: true, update: 'fill' },
  ],
  targets: {},
  layout: 'classic',
  steps: [],
  look: { colour: 'light', corners: 'rounded' },
  headline: 'Talk to us',
  buttonText: 'Send',
  language: 'en',
  after: { kind: 'message', message: '' },
  routing: { rules: [] },
  spam: { minFillMs: 2_000, scoreThreshold: 0.3 },
};

const FORM = {
  id: '0199f0a0-0000-7000-8000-0000000000f1',
  name: 'Talk to us',
  publicKey: 'talk',
  workspaceKey: 'acme',
  status: 'live',
  draft: DOCUMENT,
  live: DOCUMENT,
  liveVersionNumber: 1,
  allowedOrigins: [],
  requireSignature: false,
  submissionCount: 0,
} as unknown as FormView;

const data = {
  forms: {
    hostedUrl: (key: string) => `https://app.example.com/f/${key}`,
    embedUrl: () => 'https://app.example.com/embed/v1.js',
  },
} as unknown as DataLayer;

let shown: InApp | undefined;

beforeAll(async () => {
  await page.viewport(1280, 900);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

/** The snippet's code, as the copy field holds it. */
function snippetCode(): string {
  const field = page.getByRole('textbox', { name: /Embed snippet/ }).element();
  return field instanceof HTMLTextAreaElement ? field.value : '';
}

/** Draws the Share tab on the live form. */
async function draw() {
  shown = await renderInApp(
    () => <ShareTab slug="acme" form={FORM} isReadOnly={false} onFormChange={() => undefined} />,
    { data, pattern: '/w/$slug/captures/forms/$formId', at: '/w/acme/captures/forms/form-1' },
  );
}

describe('the Share tab (AC-11, T44)', () => {
  it('leads with the block the live dialog uses, under a heading: Copy link, the ways to send it and the QR code beside them', async () => {
    await draw();
    await expect.element(page.getByRole('heading', { name: 'Share the link' })).toBeVisible();
    await expect.element(page.getByRole('group', { name: 'Link' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Copy link/ })).toBeVisible();
    await expect.element(page.getByRole('img', { name: 'QR code for Talk to us' })).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: /^PNG/ })).toBeVisible();
    expect(page.getByRole('link', { name: 'Email' }).element().getAttribute('href')).toMatch(/^mailto:/);
    // On a wide card the code sits beside the link, at the card's right edge, not under it.
    const field = page.getByRole('group', { name: 'Link' }).element().getBoundingClientRect();
    const code = page.getByRole('img', { name: 'QR code for Talk to us' }).element().getBoundingClientRect();
    expect(code.left).toBeGreaterThan(field.right);
    expect(code.top).toBeLessThan(field.bottom);
  });

  it('offers the three ways as tiles, the made up site and the snippet following the one picked', async () => {
    await draw();
    const tiles = page.getByRole('radiogroup', { name: 'How it shows' });
    await expect.element(tiles.getByRole('radio', { name: 'In the page' })).toBeChecked();
    expect(tiles.getByRole('radio').all()).toHaveLength(3);
    // The three stack as a column, their switches under them, the made up site beside the column.
    const boxes = tiles
      .getByRole('radio')
      .all()
      .map((radio) => radio.element().closest('label')?.getBoundingClientRect());
    const [first, second] = boxes;
    expect(first !== undefined && second !== undefined && second.top >= first.bottom).toBe(true);
    const site = page.getByRole('img', { name: 'How the form sits on your site' }).element().getBoundingClientRect();
    const switchBox = page
      .getByRole('switch', { name: /Clear background/ })
      .element()
      .getBoundingClientRect();
    expect(site.left).toBeGreaterThan(tiles.element().getBoundingClientRect().right);
    expect(switchBox.top).toBeGreaterThan(tiles.element().getBoundingClientRect().bottom);
    await expect.element(page.getByRole('img', { name: 'How the form sits on your site' })).toBeVisible();
    expect(snippetCode()).not.toContain('data-timefix-mode');

    // In the page: a clear background and a hidden title rewrite the snippet.
    await userEvent.click(page.getByRole('switch', { name: /Clear background/ }), { force: true });
    await userEvent.click(page.getByRole('switch', { name: /Hide the title/ }), { force: true });
    expect(snippetCode()).toContain('data-timefix-ground="none"');
    expect(snippetCode()).toContain('data-timefix-head="none"');

    // The corner button: its words are a field beside the picture, written into the snippet as they are typed.
    await userEvent.click(tiles.getByText('Corner button', { exact: true }), { force: true });
    await expect.element(tiles.getByRole('radio', { name: 'Corner button' })).toBeChecked();
    expect(snippetCode()).toContain('data-timefix-mode="floating"');
    await userEvent.fill(page.getByRole('textbox', { name: 'Button words' }), 'Ask us');
    expect(snippetCode()).toContain('data-timefix-text="Ask us"');
    // A light form names its Colour, so a dialog's frame matches the form inside it (b7).
    expect(snippetCode()).toContain('data-timefix-theme="light"');
    // Button colour: one blue (the Accent swatch), never a second near identical one, and the hex on the row.
    const colour = page.getByRole('radiogroup', { name: 'Button colour' });
    expect(colour.getByRole('radio', { name: /Blue/ }).query()).toBeNull();
    const hex = page.getByRole('textbox', { name: 'Hex' }).element().getBoundingClientRect();
    const any = page.getByRole('button', { name: 'Any colour' }).element().getBoundingClientRect();
    expect(Math.abs(hex.top + hex.height / 2 - (any.top + any.height / 2))).toBeLessThanOrEqual(2);
  });

  it('keeps the developer material in one sheet, opened from a card of its own', async () => {
    await draw();
    expect(page.getByText('Your own HTML').query()).toBeNull();
    await expect.element(page.getByRole('heading', { name: 'For developers' })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Open For developers' }));
    const sheet = page.getByRole('dialog', { name: 'For developers' });
    await expect.element(sheet).toBeVisible();
    await expect.element(sheet.getByText('Your own HTML')).toBeVisible();
    await expect.element(sheet.getByText('Allowed sites')).toBeVisible();
    await expect.element(sheet.getByText('Signed posts')).toBeVisible();
  });

  it('fits a phone: nothing runs past the screen at 390', async () => {
    await page.viewport(390, 844);
    await draw();
    await expect.element(page.getByRole('img', { name: 'How the form sits on your site' })).toBeVisible();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    await page.viewport(1280, 900);
  });
});
