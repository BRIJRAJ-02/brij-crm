// A form's first publish in Chromium (late trap #36): when the object's email field isn't unique yet, Publish makes it
// unique, which changes how imports and every other form match there; the Where the answers go step says so first.
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

const data = {
  forms: { hostedUrl: (key: string) => `https://app.example.com/f/${key}` },
} as unknown as DataLayer;

let shown: InApp | undefined;

beforeAll(async () => {
  await page.viewport(1280, 900);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

async function openStepTwo(choices: FormTargetChoices, canBuild: boolean) {
  shown = await renderInApp(
    () => (
      <PublishDialog
        slug="acme"
        form={FORM}
        draft={DRAFT}
        target={choices}
        objects={[]}
        canBuild={canBuild}
        flush={() => Promise.resolve(1)}
        onDraftChange={() => undefined}
        onTargetChange={() => undefined}
        onPublished={() => undefined}
        onClose={() => undefined}
      />
    ),
    { data, pattern: '/w/$slug/captures/forms/$formId', at: '/w/acme/captures/forms/form-1' },
  );
  await userEvent.click(page.getByRole('button', { name: 'Next' }));
}

const SAID =
  'Publishing makes Work email unique on Graphic Designers: one record per email. Submissions, imports and other forms then update that record instead of adding another.';

describe('the first publish of a form whose email field isn’t unique (late trap #36)', () => {
  it('says Publish makes it unique, before it happens', async () => {
    await openStepTwo(target(false), true);
    await expect.element(page.getByText(SAID)).toBeVisible();
  });

  it('says nothing when it is unique already, or when the publisher may not change fields', async () => {
    await openStepTwo(target(true), true);
    await expect.element(page.getByRole('button', { name: 'Publish' })).toBeVisible();
    expect(page.getByText(SAID).query()).toBeNull();
    shown?.unmount();
    await openStepTwo(target(false), false);
    await expect.element(page.getByRole('button', { name: 'Publish' })).toBeVisible();
    expect(page.getByText(SAID).query()).toBeNull();
  });
});
