// What a form's first publish ends on, in Chromium (spec 0058, AC-6): the publish itself is one click with nothing
// asked (the owner, 5 November 2026); the Ready dialog then shows the link, its QR and three embed tiles, with no code
// until a tile is picked.
import type { DataLayer, FormDocument, FormView } from '@crm/data';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { ReadyDialog } from './PublishDialog.tsx';

const DESIGNERS = '0199f0a0-0000-7000-8000-0000000000d0';
const EMAIL = '0199f0a0-0000-7000-8000-0000000000d2';

const MATCHED: FormDocument = {
  questions: [
    {
      id: 'q-email',
      key: 'email',
      label: 'Work email',
      answerType: 'email',
      required: true,
      filedOn: { objectRole: 'main', attributeId: EMAIL },
      update: 'fill',
    },
  ],
  targets: { main: { objectId: DESIGNERS, matchAttributeId: EMAIL } },
  layout: 'classic',
  steps: [],
  look: { colour: 'light', corners: 'rounded' },
  headline: 'Apply',
  buttonText: 'Send',
  language: 'en',
  after: { kind: 'message', message: '' },
  routing: { rules: [] },
  spam: { minFillMs: 2_000, scoreThreshold: 0.3 },
};

const LIVE = {
  id: '0199f0a0-0000-7000-8000-0000000000f1',
  name: 'Apply',
  publicKey: 'apply',
  status: 'live',
  live: MATCHED,
  draft: MATCHED,
  liveVersionNumber: 1,
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

/** Opens the Ready dialog on the form just put live. */
async function open() {
  shown = await renderInApp(() => <ReadyDialog form={LIVE} onClose={() => undefined} />, {
    data,
    pattern: '/w/$slug/captures/forms/$formId',
    at: '/w/acme/captures/forms/form-1',
  });
}

describe('the Ready panel after the first publish (AC-6)', () => {
  it('shows the link, Copy, the QR and three embed tiles, and no code until a tile is picked', async () => {
    await open();
    await expect.element(page.getByRole('heading', { name: 'Your form is live' })).toBeVisible();
    await expect.element(page.getByText('https://app.example.com/f/apply')).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Copy link/ })).toBeVisible();
    // Drawn (its size comes from the library's stylesheet, which this test doesn't load).
    await expect.element(page.getByRole('img', { name: 'QR code for the link' })).toBeInTheDocument();
    const tiles = page.getByRole('radiogroup', { name: 'Put it on your site' });
    await expect.element(tiles).toBeVisible();
    expect(tiles.getByRole('radio').all()).toHaveLength(3);
    // Each tile says what it does, on the tile: not a mark and a word with the words in a tooltip.
    await expect.element(tiles.getByText('Your own button opens it in a dialog.')).toBeVisible();
    // One heading, then the form's name: not three goes at the same sentence.
    expect(page.getByText('Share the link, or put it on your site.').query()).toBeNull();
    expect(page.getByText('Point a phone’s camera at the code to open the link there.').query()).toBeNull();
    expect(page.getByRole('textbox', { name: /Embed snippet/ }).query()).toBeNull();
    // Done takes focus as the dialog opens, so Enter and Esc close it.
    await expect.element(page.getByRole('button', { name: /^Done/ })).toHaveFocus();

    // The tile's press layer covers its name, so the press lands on the tile, as a pointer's does.
    await userEvent.click(tiles.getByText('Popup', { exact: true }), { force: true });
    const snippet = page.getByRole('textbox', { name: /Embed snippet/ });
    await expect.element(snippet).toBeVisible();
    const code = snippet.element();
    expect(code instanceof HTMLTextAreaElement ? code.value : '').toContain('data-timefix-mode="popup"');
  });
});
