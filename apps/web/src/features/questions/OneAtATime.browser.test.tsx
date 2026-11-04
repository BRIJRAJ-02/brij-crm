// One at a time's own rules in Chromium (spec 0063, AC-6313; T41): each question is a screen, so each carries its
// rules, "After this question: If … → …, Otherwise → …", in the same sentence model as a step's. Add logic is one
// click from a question's ⋯, the rules sit right under the question they follow, only the questions below it are
// offered, and a rule back up the form is said where it is. Shots in both themes, the target picker open.
import type { FormQuestion } from '@crm/data';
import type { FormEnding } from '@crm/data/forms';
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
  { id: 'notes', key: 'notes', label: 'Anything else?', answerType: 'long_text', required: false, update: 'fill' },
];

const ENDINGS: readonly FormEnding[] = [{ id: 'no_fit', heading: 'Not a fit' }];

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

/** The theme the shots are taken in, once the tokens have crossed over. */
async function wear(theme: 'light' | 'dark') {
  globalThis.getSelection()?.removeAllRanges();
  document.documentElement.dataset.theme = theme;
  await new Promise<void>((settle) => {
    globalThis.setTimeout(settle, 400);
  });
}

/** The Form tab's questions with One at a time, as the editor holds them, with a warning said on one rule. */
function Builder({
  toasts,
  questions = QUESTIONS,
}: {
  readonly toasts: Toasts;
  readonly questions?: readonly FormQuestion[];
}) {
  const [flow, setFlow] = useState<Flow>({ questions, steps: [] });
  return (
    <>
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
        steps={{ steps: flow.steps, layout: 'conversational', onChange: setFlow, endings: ENDINGS }}
        logicWarnings={(place) =>
          place.kind === 'questionJump' && place.questionId === 'notes' ? ['This goes back up the form.'] : []
        }
      />
      <p>{`Rules: ${JSON.stringify(flow.questions.map((each) => [each.key, each.jumps ?? []]))}`}</p>
    </>
  );
}

async function openBuilder(questions?: readonly FormQuestion[]) {
  const toasts = createToasts();
  shown = await renderInApp(() => <Builder toasts={toasts} {...(questions === undefined ? {} : { questions })} />, {
    data: {},
    pattern: '/w/$slug/captures/forms/$formId',
    at: '/w/acme/captures/forms/form-1',
    toasts,
  });
  return shown;
}

/** Where a row sits in the list, by the words it starts with. */
const order = (text: string) =>
  [...document.querySelectorAll('[role="row"]')].findIndex((row) => row.textContent.trim().startsWith(text));

describe('One at a time: a question’s own rules (AC-6313)', () => {
  it('Add logic is one click to a rule under the question, past the next one, with a visible Otherwise', async () => {
    await openBuilder();
    await userEvent.click(page.getByRole('button', { name: /^Budget\s*Required/ }));
    await userEvent.click(page.getByRole('button', { name: 'More for Budget' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Add logic' }));
    // One sentence, ready: If Budget is Under $1k → past Team size (where everyone goes anyway) to the one after.
    await expect.element(page.getByText('After this question', { exact: true })).toBeVisible();
    await expect.element(page.getByText('Otherwise → Question 3 · Team size')).toBeVisible();
    await expect
      .element(page.getByRole('button', { name: /Jump to, Jump 1$/ }))
      .toHaveTextContent('Question 4 · Anything else?');
    // Right under the question it follows, before the next question.
    expect(order('After this question')).toBeGreaterThan(order('Budget'));
    expect(order('After this question')).toBeLessThan(order('Team size'));
    await expect.element(page.getByText(/"budget",\[\{"when".*"to":\{"step":"notes"\}/)).toBeInTheDocument();
    // Only forward: the questions below it, then the thank-you messages.
    await userEvent.click(page.getByRole('button', { name: /Jump to, Jump 1$/ }));
    expect([...document.querySelectorAll('[role="option"]')].map((option) => option.textContent)).toEqual([
      'Question 3 · Team size',
      'Question 4 · Anything else?',
      'Thank-you message: Not a fit',
    ]);
    await page.screenshot({ path: '.vitest/shots/one-at-a-time-rules-light.png' });
    await wear('dark');
    await page.screenshot({ path: '.vitest/shots/one-at-a-time-rules-dark.png' });
    await userEvent.keyboard('{Escape}');
  });

  it('adds a second rule from + Add a rule, and removing both takes the rules row away', async () => {
    await openBuilder();
    await userEvent.click(page.getByRole('button', { name: /^Budget\s*Required/ }));
    await userEvent.click(page.getByRole('button', { name: 'More for Budget' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Add logic' }));
    await userEvent.click(page.getByRole('button', { name: 'Add a rule' }));
    await expect.poll(() => document.querySelectorAll('[aria-label="Remove jump 2"]').length).toBe(1);
    await userEvent.click(page.getByRole('button', { name: 'Remove jump 2' }));
    await userEvent.click(page.getByRole('button', { name: 'Remove jump 1' }));
    await expect.element(page.getByText('After this question', { exact: true })).not.toBeInTheDocument();
    // Once it has no rules, Add logic is back in its menu.
    await userEvent.click(page.getByRole('button', { name: 'More for Budget' }));
    await expect.element(page.getByRole('menuitem', { name: 'Add logic' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
  });

  it('says what is wrong on the rule itself, and the gone target in place', async () => {
    const notes: FormQuestion = {
      ...(QUESTIONS[3] as FormQuestion),
      jumps: [{ when: { join: 'all', rules: [{ key: 'notes', op: 'is_answered' }] }, to: { step: 'budget' } }],
    };
    await openBuilder([...QUESTIONS.slice(0, 3), notes]);
    await expect.element(page.getByText('This goes back up the form.')).toBeVisible();
    // Nothing below the last question: everyone else is sent the form.
    await expect.element(page.getByText('Otherwise → After they send')).toBeVisible();
    await expect
      .element(page.getByText('This jump no longer points to a question below this one. Choose where it goes.'))
      .toBeVisible();
  });
});
