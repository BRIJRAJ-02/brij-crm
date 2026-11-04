// A Consent question in the builder (spec 0023, AC-1053), in Chromium: its label is its Wording, it says what the
// consent is for, and it never offers Where it goes, since a consent becomes a consent record, not a field. Shot in
// both themes inside the Form tab's own layout.
import type { FormQuestion } from '@crm/data';
import { createToasts, type Toasts } from '@crm/ui';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import '@crm/ui/styles.css';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { QuestionsSection } from './QuestionsSection.tsx';

const QUESTIONS: readonly FormQuestion[] = [
  { id: 'email', key: 'email', label: 'Email', answerType: 'email', required: true, update: 'fill' },
  {
    id: 'marketing',
    key: 'marketing',
    label: 'Send me the monthly note. I can unsubscribe at any time.',
    answerType: 'consent',
    required: true,
    update: 'fill',
  },
];

let shown: InApp | undefined;
let ids = 0;

beforeAll(async () => {
  await page.viewport(1280, 1000);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
  delete document.documentElement.dataset.theme;
});

/** The app's own theme attribute, then two frames and the tokens' crossover, so a shot never catches it mid-way. */
async function wear(theme: 'light' | 'dark') {
  globalThis.getSelection()?.removeAllRanges();
  document.documentElement.dataset.theme = theme;
  await new Promise<void>((settle) => {
    globalThis.setTimeout(settle, 400);
  });
}

/** The Form tab's questions over one draft that files onto People, as the editor holds them. */
function Builder({
  toasts,
  onQuestions,
}: {
  readonly toasts: Toasts;
  readonly onQuestions: (next: readonly FormQuestion[]) => void;
}) {
  const [questions, setQuestions] = useState<readonly FormQuestion[]>(QUESTIONS);
  return (
    <QuestionsSection
      questions={questions}
      onChange={(update) => {
        setQuestions((before) => {
          const next = update(before);
          onQuestions(next);
          return next;
        });
      }}
      max={50}
      holder="A form"
      keptWith="submission"
      attributes={[]}
      objectName="People"
      liveIds={new Set()}
      newId={() => `new${String((ids += 1))}`}
      toasts={toasts}
      isReadOnly={false}
    />
  );
}

describe('a Consent question in the builder (AC-1053)', () => {
  it('edits its exact wording and purpose, offers no field to file on, and draws in both themes', async () => {
    const toasts = createToasts();
    let latest: readonly FormQuestion[] = QUESTIONS;
    shown = await renderInApp(
      () => (
        <Builder
          toasts={toasts}
          onQuestions={(next) => {
            latest = next;
          }}
        />
      ),
      { data: {}, pattern: '/w/$slug/captures/forms/$formId', at: '/w/acme/captures/forms/form-1', toasts },
    );
    await userEvent.click(page.getByRole('button', { name: /^Send me the monthly note/ }));
    await expect.element(page.getByRole('textbox', { name: 'Wording' })).toBeVisible();
    await expect.element(page.getByText('Save answer to')).not.toBeInTheDocument();
    await expect.element(page.getByText('Consent', { exact: true }).first()).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: /Marketing emails/ }));
    await userEvent.click(page.getByRole('option', { name: 'Terms and privacy' }));
    expect(latest.find((each) => each.id === 'marketing')?.options?.purpose).toBe('terms');
    await page.screenshot({ path: '.vitest/shots/consent-builder-light.png' });
    await wear('dark');
    await page.screenshot({ path: '.vitest/shots/consent-builder-dark.png' });
  });
});
