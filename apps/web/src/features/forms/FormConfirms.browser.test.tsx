// The forms' confirms in Chromium (spec 0058, AC-18; the owner's rule, 21 October 2026): Delete form, Rotate secret,
// Remove site and the object change each stay a Modal that asks its question, says one short line of what happens,
// and offers two buttons, the way out first and the verb last.
import type { DataLayer } from '@crm/data';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { DeleteFormDialog, RemoveSiteDialog, RetargetFormDialog, RotateSecretDialog } from './FormConfirms.tsx';

const FORM = { id: '0199f0a0-0000-7000-8000-0000000000f1', name: 'Demo request', submissionCount: 12 };

const data = { forms: {} } as unknown as DataLayer;

let shown: InApp | undefined;

beforeAll(async () => {
  await page.viewport(1280, 900);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

async function show(dialog: () => ReactNode) {
  shown = await renderInApp(dialog, { data, pattern: '/w/$slug/captures/forms', at: '/w/acme/captures/forms' });
}

/** The confirm by its question: one line under it, under 12 words, and two buttons, Cancel then the verb. */
async function expectOneLine(question: string, verb: string) {
  const confirm = page.getByRole('alertdialog', { name: question });
  await expect.element(confirm).toBeVisible();
  const words = (confirm.element().querySelector('p')?.textContent ?? '').trim().split(/\s+/).length;
  expect(words).toBeGreaterThan(1);
  expect(words).toBeLessThan(12);
  const buttons = confirm.getByRole('button').all();
  expect(buttons).toHaveLength(2);
  expect(buttons[0]?.element().textContent).toMatch(/^Cancel/);
  expect(buttons[1]?.element().textContent).toContain(verb);
}

describe('the forms’ confirms (AC-18)', () => {
  it('Delete form asks with one line and two buttons', async () => {
    await show(() => (
      <DeleteFormDialog data={data} slug="acme" form={FORM} onClose={() => undefined} onDone={() => undefined} />
    ));
    await expectOneLine('Delete “Demo request”?', 'Delete form');
    await expect.element(page.getByText('Its 12 submissions are gone for good; records stay.')).toBeVisible();
  });

  it('Rotate secret asks with one line and two buttons', async () => {
    await show(() => (
      <RotateSecretDialog data={data} slug="acme" form={FORM} onClose={() => undefined} onDone={() => undefined} />
    ));
    await expectOneLine('Rotate the signing secret?', 'Rotate secret');
  });

  it('Remove site asks with one line and two buttons', async () => {
    await show(() => (
      <RemoveSiteDialog site="https://acme.com" onRemove={() => Promise.resolve()} onClose={() => undefined} />
    ));
    await expectOneLine('Remove https://acme.com?', 'Remove site');
  });

  it('changing or turning off where submissions are saved asks with one line and two buttons', async () => {
    await show(() => (
      <RetargetFormDialog
        ask={{ objectId: 'deals', filedCount: 3, objectName: 'People', nextName: 'Deals' }}
        onClose={() => undefined}
        onConfirm={() => undefined}
      />
    ));
    await expectOneLine('Change which object submissions are saved to?', 'Change object');
    shown?.unmount();
    await show(() => (
      <RetargetFormDialog
        ask={{ objectId: null, filedCount: 3, objectName: 'People', nextName: '' }}
        onClose={() => undefined}
        onConfirm={() => undefined}
      />
    ));
    await expectOneLine('Stop saving submissions to the CRM?', 'Stop saving');
  });
});
