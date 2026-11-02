// The logic rows and the Flow view in Chromium (spec 0063, AC-6313, AC-6316, AC-6325): a step divider's Jumps row,
// a choice question's points, and the Flow view's read only picture of the steps, their jumps and the endings. The
// shots are taken inside the Form tab's own layout, in both themes, with the target picker open.
import type { FormDocument, FormQuestion } from '@crm/data';
import type { FormEnding, FormStep } from '@crm/data/forms';
import { createToasts, type Toasts } from '@crm/ui';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import '@crm/ui/styles.css';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { FlowView } from '../forms/FlowView.tsx';
import { QuestionsSection } from './QuestionsSection.tsx';
import type { Flow } from './steps.ts';

const QUESTIONS: readonly FormQuestion[] = [
  { id: 'name', key: 'name', label: 'Your name', answerType: 'short_text', required: true, update: 'fill' },
  {
    id: 'budget',
    key: 'budget',
    label: 'Budget',
    answerType: 'choice',
    required: true,
    update: 'fill',
    choices: ['Under $1k', '$5k', '$10k'],
  },
  { id: 'team', key: 'team', label: 'Team size', answerType: 'number', required: false, update: 'fill' },
];

const STEPS: readonly FormStep[] = [
  {
    id: 's2',
    title: 'Your budget',
    startsAt: 'budget',
    jumps: [
      {
        when: { join: 'all', rules: [{ key: 'budget', op: 'is', value: 'Under $1k' }] },
        to: { ending: 'no_fit' },
      },
    ],
  },
  { id: 's3', title: 'Your team', startsAt: 'team' },
];

const ENDINGS: readonly FormEnding[] = [
  { id: 'no_fit', heading: 'Thanks, we are not a fit', line: 'We only take projects over $5k.' },
];

const DOCUMENT: FormDocument = {
  questions: [...QUESTIONS],
  steps: [...STEPS],
  endings: [...ENDINGS],
  layout: 'steps',
  targets: {},
  look: { colour: 'light', corners: 'rounded' },
  headline: 'Tell us about the work',
  buttonText: 'Send',
  language: 'en',
  after: { kind: 'message', message: '' },
  routing: { rules: [] },
  spam: { minFillMs: 2_000, scoreThreshold: 0.3 },
};

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

/**
 * The theme the shots are taken in: the app's own root attribute, as the theme switch sets it. The shot waits two
 * frames afterwards, since the tokens cross over with a transition and a shot taken on the same frame catches
 * every control mid-way between the two themes.
 */
async function wear(theme: 'light' | 'dark') {
  // Typing leaves a selection behind, which would paint every field in the shot: cleared, so the shot is the UI.
  globalThis.getSelection()?.removeAllRanges();
  document.documentElement.dataset.theme = theme;
  await new Promise<void>((settle) => {
    globalThis.requestAnimationFrame(() => {
      globalThis.requestAnimationFrame(() => {
        settle();
      });
    });
  });
  await new Promise<void>((settle) => {
    globalThis.setTimeout(settle, 400);
  });
}

/** The Form tab's questions and dividers over one draft, as the editor holds them. */
function Builder({ toasts }: { readonly toasts: Toasts }) {
  const [flow, setFlow] = useState<Flow>({ questions: QUESTIONS, steps: STEPS });
  return (
    <QuestionsSection
      questions={flow.questions}
      onChange={(update) => {
        setFlow((before) => ({ ...before, questions: update(before.questions) }));
      }}
      max={50}
      holder="A form"
      keptWith="submission"
      attributes={[]}
      liveIds={new Set()}
      newId={() => `new${String((ids += 1))}`}
      toasts={toasts}
      isReadOnly={false}
      steps={{ steps: flow.steps, layout: 'steps', onChange: setFlow, endings: ENDINGS }}
    />
  );
}

async function openBuilder() {
  const toasts = createToasts();
  shown = await renderInApp(() => <Builder toasts={toasts} />, {
    data: {},
    pattern: '/w/$slug/captures/forms/$formId',
    at: '/w/acme/captures/forms/form-1',
    toasts,
  });
  return shown;
}

describe('a step’s Jumps row (AC-6313, AC-6325)', () => {
  it('shows the jump it has, offers only the targets below it, and draws in both themes', async () => {
    await openBuilder();
    await userEvent.click(page.getByRole('button', { name: /^Step 2 · Your budget/ }));
    // The jump it has: its conditions, then where it goes.
    await expect.element(page.getByText('Jumps')).toBeVisible();
    await expect.element(page.getByText('Jump 1')).toBeVisible();
    const target = page.getByRole('button', { name: /Then$/ });
    await userEvent.click(target);
    // Only forward: the step below it and the form's ending, never itself or the step above.
    await expect.element(page.getByRole('option', { name: 'Go to step 3, Your team' })).toBeVisible();
    await expect.element(page.getByRole('option', { name: 'End with “Thanks, we are not a fit”' })).toBeVisible();
    // Never itself or the step above it: the only step offered is the one below.
    expect([...document.querySelectorAll('[role="option"]')].map((option) => option.textContent)).toEqual([
      'Go to step 3, Your team',
      'End with “Thanks, we are not a fit”',
    ]);
    await page.screenshot({ path: '.vitest/shots/s5-jumps-light.png' });
    await wear('dark');
    await page.screenshot({ path: '.vitest/shots/s5-jumps-dark.png' });
    await userEvent.keyboard('{Escape}');
  });

  it('shows a number for each choice of a scored question, in both themes', async () => {
    await openBuilder();
    await userEvent.click(page.getByRole('button', { name: /^Budget/ }));
    await expect.element(page.getByRole('textbox', { name: 'Points for Under $1k' })).toBeVisible();
    await userEvent.fill(page.getByRole('textbox', { name: 'Points for $10k' }), '5');
    await expect.element(page.getByRole('textbox', { name: 'Points for $10k' })).toHaveValue('5');
    await page.screenshot({ path: '.vitest/shots/s5-points-light.png' });
    await wear('dark');
    await page.screenshot({ path: '.vitest/shots/s5-points-dark.png' });
  });
});

describe('the Flow view (AC-6325)', () => {
  it('draws the steps, their jumps and the endings, read only, in both themes', async () => {
    const toasts = createToasts();
    shown = await renderInApp(
      () => (
        <FlowView
          draft={DOCUMENT}
          isOpen
          questionHref={(id) => `/w/acme/captures/forms/form-1?question=${id}`}
          stepHref={(id) => `/w/acme/captures/forms/form-1?question=step:${id}`}
          endingsHref="/w/acme/captures/forms/form-1/settings"
          onOpenChange={() => undefined}
        />
      ),
      { data: {}, pattern: '/w/$slug/captures/forms/$formId', at: '/w/acme/captures/forms/form-1', toasts },
    );
    await expect.element(page.getByRole('heading', { name: 'The flow' })).toBeVisible();
    await expect.element(page.getByText('Step 1').first()).toBeVisible();
    await expect.element(page.getByText('Step 2 · Your budget').first()).toBeVisible();
    // The fall through says where it goes, by name, never an empty value.
    await expect.element(page.getByText('Step 3 · Your team').first()).toBeVisible();
    // The jump as one line, in words, and the ending it goes to.
    await expect.element(page.getByText('If Budget is Under $1k')).toBeVisible();
    await expect.element(page.getByText('End with “Thanks, we are not a fit”')).toBeVisible();
    await expect.element(page.getByText('Endings')).toBeVisible();
    await page.screenshot({ path: '.vitest/shots/s5-flow-light.png' });
    await wear('dark');
    await page.screenshot({ path: '.vitest/shots/s5-flow-dark.png' });
  });
});
