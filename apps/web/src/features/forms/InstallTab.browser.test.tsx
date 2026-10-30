// A form's Install tab in Chromium (spec 0058, AC-11): the three ways a site shows the form are tiles, each with a
// picture and a name, In the page chosen; picking one changes the snippet; the developer material (own HTML, allowed
// sites, signed posts) waits behind one For developers disclosure, closed until opened.
import type { DataLayer, FormDocument, FormView } from '@crm/data';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { InstallTab } from './InstallTab.tsx';

const DOCUMENT: FormDocument = {
  questions: [
    { id: 'q-email', key: 'email', label: 'Work email', answerType: 'email', required: true, update: 'fill' },
  ],
  targets: {},
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

describe('the Install tab (AC-11)', () => {
  it('offers the three ways as tiles, and the snippet follows the one picked', async () => {
    shown = await renderInApp(
      () => <InstallTab slug="acme" form={FORM} isReadOnly={false} onFormChange={() => undefined} />,
      { data, pattern: '/w/$slug/captures/forms/$formId', at: '/w/acme/captures/forms/form-1' },
    );
    const tiles = page.getByRole('radiogroup', { name: 'How it shows' });
    await expect.element(tiles.getByRole('radio', { name: 'In the page' })).toBeChecked();
    expect(tiles.getByRole('radio').all()).toHaveLength(3);
    expect(snippetCode()).not.toContain('data-timefix-mode');

    // The tile's press layer covers its name, so the press lands on the tile, as a pointer's does.
    await userEvent.click(tiles.getByText('Corner button', { exact: true }), { force: true });
    await expect.element(tiles.getByRole('radio', { name: 'Corner button' })).toBeChecked();
    expect(snippetCode()).toContain('data-timefix-mode="floating"');
    // The one thing a site may change, said under the snippet it is about.
    await expect.element(page.getByText('Change its words in data-timefix-text.')).toBeVisible();
  });

  it('keeps the developer material behind one For developers disclosure, closed by default', async () => {
    shown = await renderInApp(
      () => <InstallTab slug="acme" form={FORM} isReadOnly={false} onFormChange={() => undefined} />,
      { data, pattern: '/w/$slug/captures/forms/$formId', at: '/w/acme/captures/forms/form-1' },
    );
    const developers = page.getByRole('button', { name: 'For developers' });
    await expect.element(developers).toHaveAttribute('aria-expanded', 'false');
    // Closed: nothing in it shows (the panel may keep its content, hidden).
    expect(page.getByText('Your own HTML').query()?.checkVisibility() ?? false).toBe(false);
    await userEvent.click(developers);
    await expect.element(developers).toHaveAttribute('aria-expanded', 'true');
    await expect.element(page.getByText('Your own HTML')).toBeVisible();
    await expect.element(page.getByText('Allowed sites')).toBeVisible();
    await expect.element(page.getByText('Signed posts')).toBeVisible();
  });
});
