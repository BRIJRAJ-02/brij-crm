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

describe('a step’s Logic (AC-6313, AC-6325; T15)', () => {
  it('shows the rule it has, offers only the targets below it, says where everyone else goes, in both themes', async () => {
    await openBuilder();
    // A step with logic shows it under its header, always (T20).
    // The rule it has, in Typeform's words: its conditions, then Jump to, then where everyone else goes.
    await expect.element(page.getByText('Logic', { exact: true })).toBeVisible();
    await expect.element(page.getByText('Otherwise, go to Step 3 · Your team')).toBeVisible();
    const target = page.getByRole('button', { name: /Jump to$/ });
    await userEvent.click(target);
    // Only forward: the step below it and the form's ending, never itself or the step above.
    expect([...document.querySelectorAll('[role="option"]')].map((option) => option.textContent)).toEqual([
      'Step 3 · Your team',
      'Ending: Thanks, we are not a fit',
    ]);
    await page.screenshot({ path: '.vitest/shots/s5-jumps-light.png' });
    await wear('dark');
    await page.screenshot({ path: '.vitest/shots/s5-jumps-dark.png' });
    await userEvent.keyboard('{Escape}');
  });

  it('Add logic is one click to a working rule: the step’s choice question, its first option, the next place', async () => {
    await openBuilder();
    // Add logic is in the step header's menu (T20).
    await userEvent.click(page.getByRole('button', { name: 'Step 2 · Your budget options' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Add logic' }));
    // A second rule, ready filled: Budget is Under $1k, Jump to Step 3. Nothing to fill in before it works.
    await expect.poll(() => document.querySelectorAll('[aria-label="Remove jump 2"]').length).toBe(1);
    const pickers = [...document.querySelectorAll('button')].filter((each) =>
      each.textContent.includes('Step 3 · Your team'),
    );
    expect(pickers.length).toBeGreaterThan(0);
  });

  it('Show only if… is one click to a ready condition, and Always show takes it away', async () => {
    await openBuilder();
    await userEvent.click(page.getByRole('button', { name: 'Step 3 · Your team options' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Show only if…' }));
    await expect.element(page.getByText('Show only if', { exact: true })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Always show' }));
    await expect.element(page.getByText('Show only if', { exact: true })).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Step 3 · Your team options' })).toHaveFocus();
  });

  it('gives points in one click, then a number for each choice, in both themes', async () => {
    await openBuilder();
    await userEvent.click(page.getByRole('button', { name: /^Budget/ }));
    // No points until asked (T20, Typeform's score): Give points is one click to 1, 2, 3.
    expect(page.getByRole('textbox', { name: 'Points for Under $1k' }).query()).toBeNull();
    await userEvent.click(page.getByRole('button', { name: 'Give points' }));
    await expect.element(page.getByRole('textbox', { name: 'Points for Under $1k' })).toHaveValue('1');
    await expect.element(page.getByRole('textbox', { name: 'Points for $10k' })).toHaveValue('3');
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
    await expect.element(page.getByRole('heading', { name: 'Flow' })).toBeVisible();
    await expect.element(page.getByText('Step 1').first()).toBeVisible();
    await expect.element(page.getByText('Step 2 · Your budget').first()).toBeVisible();
    // The fall through says where it goes, by name, never an empty value.
    await expect.element(page.getByText('Step 3 · Your team').first()).toBeVisible();
    // The jump as one line, in words, and the ending it goes to; then where everyone else goes.
    await expect.element(page.getByText('If Budget is Under $1k')).toBeVisible();
    await expect.element(page.getByText('Jump to Ending: Thanks, we are not a fit')).toBeVisible();
    await expect.element(page.getByText('Otherwise')).toBeVisible();
    // Every end is listed: the form's own thank you page first, then its endings.
    await expect.element(page.getByText('Endings')).toBeVisible();
    await expect.element(page.getByText('Thank you page').first()).toBeVisible();
    await page.screenshot({ path: '.vitest/shots/s5-flow-light.png' });
    await wear('dark');
    await page.screenshot({ path: '.vitest/shots/s5-flow-dark.png' });
  });
});
