// What a form's first publish ends on, in Chromium (spec 0058, AC-6; T44): the publish itself is one click with
// nothing asked (the owner, 5 November 2026); the live dialog then says it in one line and shares the link, with one
// quiet way to the Share tab's embeds.
// The layout is measured, so the library's tokens come first, as main.tsx loads them.
import '@crm/ui/app.css';
import type { DataLayer, FormDocument, FormView } from '@crm/data';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
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
  shown = await renderInApp(() => <ReadyDialog slug="acme" form={LIVE} onClose={() => undefined} />, {
    data,
    pattern: '/w/$slug/captures/forms/$formId',
    at: '/w/acme/captures/forms/form-1',
  });
}

describe('the live dialog after the first publish (AC-6, T44)', () => {
  it('says it in one line: the link with Copy link, one row of equal buttons, the QR code with its download, and a row to the embeds', async () => {
    await open();
    // One line: the form's own name, live; no second line repeating it.
    await expect.element(page.getByRole('heading', { name: 'Apply is live' })).toBeVisible();
    expect(page.getByText('Your form is live').query()).toBeNull();
    // The link, its own name strong, with Copy link (the one primary), and its QR code.
    await expect.element(page.getByRole('img', { name: 'QR code for Apply' })).toBeInTheDocument();
    await expect.element(page.getByRole('group', { name: 'Link' })).toBeVisible();
    await expect.element(page.getByText('apply', { exact: true })).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Copy link/ })).toBeVisible();
    // One row of equal buttons: Email and WhatsApp (and More where the browser has a share sheet).
    const ways = page.getByRole('group', { name: 'Send the link' }).element();
    const widths = new Set([...ways.children].map((each) => Math.round(each.getBoundingClientRect().width)));
    expect(widths.size).toBe(1);
    expect(page.getByRole('link', { name: 'Email' }).element().getAttribute('href')).toMatch(/^mailto:/);
    expect(page.getByRole('link', { name: 'WhatsApp' }).element().getAttribute('href')).toMatch(/^https:\/\/wa\.me\//);
    // The QR code's download sits with the code, not in the row (PNG or SVG from its menu).
    await expect.element(page.getByRole('button', { name: /^PNG/ })).toBeVisible();
    expect(ways.contains(page.getByRole('button', { name: /^PNG/ }).element())).toBe(false);
    // No embed tiles or code here: one row to the Share tab, where they are set up with a preview.
    expect(page.getByRole('radiogroup').query()).toBeNull();
    expect(page.getByRole('textbox', { name: /Embed snippet/ }).query()).toBeNull();
    expect(page.getByRole('link', { name: 'Put it on your site' }).element().getAttribute('href')).toContain(
      'tab=share',
    );
    // One primary: Copy link. Done only closes, and takes focus as the dialog opens.
    const primaries = [...document.querySelectorAll('[role="dialog"] button[data-variant="primary"]')];
    expect(primaries.map((button) => button.getAttribute('aria-label') ?? button.textContent)).toHaveLength(1);
    expect(primaries[0]?.textContent).toContain('Copy link');
    await expect.element(page.getByRole('button', { name: /^Done/ })).toHaveFocus();
  });

  it('says once at the footer what the first publish set up in the CRM, with Change on the same line', async () => {
    shown = await renderInApp(
      () => (
        <ReadyDialog
          slug="acme"
          form={LIVE}
          filing={{ objectName: 'People', made: ['Budget'] }}
          onClose={() => undefined}
        />
      ),
      { data, pattern: '/w/$slug/captures/forms/$formId', at: '/w/acme/captures/forms/form-1' },
    );
    await expect.element(page.getByText(/Answers go to People · 1 new field: Budget/)).toBeVisible();
    const change = page.getByRole('link', { name: 'Change' }).element();
    const line = page.getByText(/Answers go to People/).element();
    // One line: Change sits on the line it ends, never wrapped onto its own.
    expect(Math.abs(change.getBoundingClientRect().top - line.getBoundingClientRect().top)).toBeLessThanOrEqual(4);
  });
});
