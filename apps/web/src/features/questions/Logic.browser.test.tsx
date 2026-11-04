// The logic rows and the Flow view in Chromium (spec 0063, AC-6313, AC-6316, AC-6325): a step divider's Jumps row,
// a choice question's points, and the Flow view's read only picture of the steps, their jumps and the endings. The
// shots are taken inside the Form tab's own layout, in both themes, with the target picker open.
import type { FormQuestion } from '@crm/data';
import type { FormEnding, FormStep } from '@crm/data/forms';
import { createToasts, type Toasts } from '@crm/ui';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import '@crm/ui/styles.css';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
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
    // A step with logic shows it, always (T20), as sentences (T41): "If … → …", then a visible Otherwise.
    await expect.element(page.getByText('After this step', { exact: true })).toBeVisible();
    // Under the step's last question, read after what it reads (critique c, 7), and before the next step.
    const order = (text: string) =>
      [...document.querySelectorAll('[role="row"]')].findIndex((row) => row.textContent.trim().startsWith(text));
    expect(order('After this step')).toBeGreaterThan(order('Budget'));
    expect(order('Budget')).toBeGreaterThan(-1);
    expect(order('After this step')).toBeLessThan(order('Step 3 · Your team'));
    await expect.element(page.getByText('Otherwise → Step 3 · Your team')).toBeVisible();
    const target = page.getByRole('button', { name: /Jump to, Jump 1$/ });
    await userEvent.click(target);
    // Only forward: the step below it and the form's ending, never itself or the step above.
    expect([...document.querySelectorAll('[role="option"]')].map((option) => option.textContent)).toEqual([
      'Step 3 · Your team',
      'Thank-you message: Thanks, we are not a fit',
    ]);
    await page.screenshot({ path: '.vitest/shots/s5-jumps-light.png' });
    await wear('dark');
    await page.screenshot({ path: '.vitest/shots/s5-jumps-dark.png' });
    await userEvent.keyboard('{Escape}');
  });

  it('Add logic is one click to a rule that changes something: the step’s choice question, past the next step', async () => {
    await openBuilder();
    // Once a step has a rule, + Add a rule sits under its rules (the menu doesn't repeat it).
    await userEvent.click(page.getByRole('button', { name: 'Add a rule' }));
    // A second rule, ready filled: Budget is Under $1k. It never jumps to the next step, where everyone goes anyway
    // (a rule that did nothing): with Step 3 next, it goes to the form's ending.
    await expect.poll(() => document.querySelectorAll('[aria-label="Remove jump 2"]').length).toBe(1);
    const targets = [...document.querySelectorAll('button')].filter((each) =>
      each.textContent.includes('Thank-you message: Thanks, we are not a fit'),
    );
    expect(targets.length).toBe(2);
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
    await userEvent.click(page.getByRole('button', { name: /^Budget\s*Required/ }));
    // No points until asked (T20, Typeform's score): Give points is one click to 1, 2, 3.
    expect(page.getByRole('textbox', { name: 'Points for Under $1k' }).query()).toBeNull();
    // Under the question's one ⋯ (T40): the footer holds Required and the menu only.
    await userEvent.click(page.getByRole('button', { name: 'More for Budget' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Give points' }));
    await expect.element(page.getByRole('textbox', { name: 'Points for Under $1k' })).toHaveValue('1');
    await expect.element(page.getByRole('textbox', { name: 'Points for $10k' })).toHaveValue('3');
    await userEvent.fill(page.getByRole('textbox', { name: 'Points for $10k' }), '5');
    await expect.element(page.getByRole('textbox', { name: 'Points for $10k' })).toHaveValue('5');
    await page.screenshot({ path: '.vitest/shots/s5-points-light.png' });
    await wear('dark');
    await page.screenshot({ path: '.vitest/shots/s5-points-dark.png' });
  });
});
