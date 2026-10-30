// A form's first publish in Chromium (spec 0058, AC-13 and AC-6): one step with the name, the link, where submissions
// are saved and each question's field as a row that stays changeable; the one line that says an email field becomes
// unique before Publish makes it so (late trap #36); then the Ready panel with the link, its QR and three embed tiles,
// and no code until a tile is picked.
import type { DataLayer, FormAttributeChoice, FormDocument, FormTargetChoices, FormView } from '@crm/data';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { PublishDialog } from './PublishDialog.tsx';

const DESIGNERS = '0199f0a0-0000-7000-8000-0000000000d0';
const EMAIL = '0199f0a0-0000-7000-8000-0000000000d2';

const DRAFT: FormDocument = {
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
  // An object made by hand: its email isn't unique, so there is no match yet.
  targets: { main: { objectId: DESIGNERS } },
  look: { colour: 'light', corners: 'rounded' },
  headline: 'Apply',
  buttonText: 'Send',
  language: 'en',
  after: { kind: 'message', message: '' },
  routing: { rules: [] },
  spam: { minFillMs: 2_000, scoreThreshold: 0.3 },
};

/** The same form once its email is the match: nothing more to ask before Publish. */
const MATCHED: FormDocument = { ...DRAFT, targets: { main: { objectId: DESIGNERS, matchAttributeId: EMAIL } } };

const email = (isUnique: boolean): FormAttributeChoice => ({
  attributeId: EMAIL,
  title: 'Work email',
  type: 'email',
  isRequired: false,
  isUnique,
  canWrite: true,
});

const target = (isUnique: boolean): FormTargetChoices => ({
  objectId: DESIGNERS,
  objectName: 'Graphic Designers',
  items: [email(isUnique)],
});

const FORM = {
  id: '0199f0a0-0000-7000-8000-0000000000f1',
  name: 'Apply',
  publicKey: 'apply',
  status: 'live',
  draft: DRAFT,
} as unknown as FormView;

const LIVE = { ...FORM, live: MATCHED, draft: MATCHED, liveVersionNumber: 1 } as unknown as FormView;

const data = {
  forms: {
    hostedUrl: (key: string) => `https://app.example.com/f/${key}`,
    embedUrl: () => 'https://app.example.com/embed/v1.js',
    publish: () => Promise.resolve(LIVE),
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

/** Opens the dialog; answers every draft it hands back, last first. */
async function open(
  options: {
    readonly draft?: FormDocument;
    readonly choices?: FormTargetChoices;
    readonly canBuild?: boolean;
  } = {},
) {
  const changes: FormDocument[] = [];
  shown = await renderInApp(
    () => (
      <PublishDialog
        slug="acme"
        form={FORM}
        draft={options.draft ?? DRAFT}
        target={options.choices ?? target(false)}
        objects={[]}
        canBuild={options.canBuild ?? true}
        flush={() => Promise.resolve(1)}
        onDraftChange={(next) => {
          changes.unshift(next);
        }}
        onTargetChange={() => undefined}
        onPublished={() => undefined}
        onClose={() => undefined}
      />
    ),
    { data, pattern: '/w/$slug/captures/forms/$formId', at: '/w/acme/captures/forms/form-1' },
  );
  return changes;
}

const SAID = 'Work email becomes unique on Graphic Designers: one record per email.';

describe('the first publish, in one step (AC-13)', () => {
  it('shows the name, the link, where submissions go and each answer’s field at once, with no Next', async () => {
    await open();
    const dialog = page.getByRole('dialog', { name: 'Publish your form' });
    await expect.element(dialog).toBeVisible();
    await expect.element(dialog.getByLabelText('Name')).toHaveValue('Apply');
    await expect.element(dialog.getByRole('textbox', { name: /^Link/ })).toHaveValue('apply');
    await expect.element(dialog.getByRole('button', { name: /Save to$/ })).toBeVisible();
    // The answer's row names its question and the field it fills, as a chip that opens a choice.
    const row = dialog.getByRole('row', { name: /Work email/ });
    await expect.element(row.getByRole('button', { name: /saved as$/ })).toHaveTextContent('Work email');
    expect(dialog.getByRole('button', { name: 'Next' }).query()).toBeNull();
    await expect.element(dialog.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled();
  });

  it('keeps each row changeable: an answer can stay with the submission only', async () => {
    const changes = await open();
    await userEvent.click(page.getByRole('button', { name: /Work email, saved as$/ }));
    await userEvent.click(page.getByRole('listbox').getByRole('option', { name: 'Submission only' }));
    const question = changes[0]?.questions[0];
    expect(question?.filedOn).toBeUndefined();
    expect(question?.kept).toBe(true);
  });

  it('makes nothing when New object is picked: it waits for Publish, and says what it will make', async () => {
    await open();
    await userEvent.click(page.getByRole('button', { name: /Save to$/ }));
    await userEvent.click(page.getByRole('listbox').getByRole('option', { name: /^New object “Apply”/ }));
    // Picking it only chose it (the fake data layer has no objects.create, so a call would have failed loudly).
    await expect.element(page.getByRole('button', { name: /Save to$/ })).toBeVisible();
    expect(page.getByRole('button', { name: /Save to$/ }).element().textContent).toContain(
      '1 field from its questions',
    );
    // Every question gets its own field, so there are no rows to match.
    expect(page.getByRole('button', { name: /saved as$/ }).query()).toBeNull();
    expect(page.getByRole('alert').query()).toBeNull();
  });

  it('says in one line that Publish makes the email unique, before it happens (late trap #36)', async () => {
    await open();
    await expect.element(page.getByText(SAID)).toBeVisible();
    // One line: no word count past the limit, and no second sentence.
    expect(SAID.split(' ').length).toBeLessThan(12);
  });

  it('says nothing when it is unique already, or when the publisher may not change fields', async () => {
    await open({ choices: target(true) });
    await expect.element(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible();
    expect(page.getByText(SAID).query()).toBeNull();
    shown?.unmount();
    await open({ canBuild: false });
    await expect.element(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible();
    expect(page.getByText(SAID).query()).toBeNull();
  });
});

describe('the Ready panel after the first publish (AC-6)', () => {
  it('shows the link, Copy, the QR and three embed tiles, and no code until a tile is picked', async () => {
    await open({ draft: MATCHED, choices: target(true) });
    await userEvent.click(page.getByRole('button', { name: 'Publish', exact: true }));
    await expect.element(page.getByRole('heading', { name: 'Your form is live' })).toBeVisible();
    await expect.element(page.getByText('https://app.example.com/f/apply')).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Copy link/ })).toBeVisible();
    // Drawn (its size comes from the library's stylesheet, which this test doesn't load).
    await expect.element(page.getByRole('img', { name: 'QR code for the link' })).toBeInTheDocument();
    const tiles = page.getByRole('radiogroup', { name: 'Put it on your site' });
    await expect.element(tiles).toBeVisible();
    expect(tiles.getByRole('radio').all()).toHaveLength(3);
    expect(page.getByRole('textbox', { name: /Embed snippet/ }).query()).toBeNull();
    // Done takes focus as Publish leaves, so Esc and the dialog's name stay with it.
    await expect.element(page.getByRole('button', { name: /^Done/ })).toHaveFocus();

    // The tile's press layer covers its name, so the press lands on the tile, as a pointer's does.
    await userEvent.click(tiles.getByText('Popup', { exact: true }), { force: true });
    const snippet = page.getByRole('textbox', { name: /Embed snippet/ });
    await expect.element(snippet).toBeVisible();
    const code = snippet.element();
    expect(code instanceof HTMLTextAreaElement ? code.value : '').toContain('data-timefix-mode="popup"');
  });
});
