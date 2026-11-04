// Layout and Steps as pages in Chromium (spec 0063, AC-6302, AC-6303; T20, 5 November 2026): Steps splits the form
// at once into headed pages, Split here makes another, a header renames in place and merges up with Undo, and Classic
// draws no headers. Moving one is the list's own drag (QuestionList's keyboard story) over `moveItem`.
import type { FormDocument, FormQuestion } from '@crm/data';
import { previewOf, type FormLayout, type FormStep } from '@crm/data/forms';
import { createToasts, HostedFormPreview, type Toasts } from '@crm/ui';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import '@crm/ui/styles.css';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { LayoutCard } from '../forms/LayoutCard.tsx';
import { QuestionsSection } from './QuestionsSection.tsx';
import { splitIntoSteps, type Flow } from './steps.ts';

const question = (id: string, label: string): FormQuestion => ({
  id,
  key: id,
  label,
  answerType: 'short_text',
  required: false,
  update: 'fill',
});

const QUESTIONS = [question('name', 'Your name'), question('company', 'Company'), question('size', 'Team size')];

let shown: InApp | undefined;
let ids = 0;

beforeAll(async () => {
  await page.viewport(1280, 900);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

/** The Form tab's two parts over one draft, as the editor holds it, with the preview beside them. */
function Builder({
  initialLayout,
  initialSteps,
  toasts,
}: {
  readonly initialLayout: FormLayout;
  readonly initialSteps: readonly FormStep[];
  readonly toasts: Toasts;
}) {
  const [layout, setLayout] = useState<FormLayout>(initialLayout);
  const [flow, setFlow] = useState<Flow>({ questions: QUESTIONS, steps: initialSteps });
  const draft: FormDocument = {
    questions: [...flow.questions],
    steps: [...flow.steps],
    layout,
    targets: {},
    look: { colour: 'light', corners: 'rounded' },
    headline: 'Tell us about you',
    buttonText: 'Send',
    language: 'en',
    after: { kind: 'message', message: '' },
    routing: { rules: [] },
    spam: { minFillMs: 2_000, scoreThreshold: 0.3 },
  };
  return (
    <>
      <LayoutCard
        layout={layout}
        isReadOnly={false}
        onChange={(next) => {
          setLayout(next);
          // As the editor does: Steps splits the form into pages at once.
          if (next === 'steps') {
            setFlow((before) =>
              splitIntoSteps(before, () => `new${String((ids += 1))}`, { details: 'Your details', rest: 'About you' }),
            );
          }
        }}
      />
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
        steps={{ steps: flow.steps, layout, onChange: setFlow }}
      />
      <HostedFormPreview form={previewOf(draft, { key: 'test' })} />
    </>
  );
}

async function open(layout: FormLayout, steps: readonly FormStep[] = []) {
  const toasts = createToasts();
  shown = await renderInApp(() => <Builder initialLayout={layout} initialSteps={steps} toasts={toasts} />, {
    data: {},
    pattern: '/w/$slug/captures/forms/$formId',
    at: '/w/acme/captures/forms/form-1',
    toasts,
  });
  return shown;
}

describe('Layout (AC-6302)', () => {
  it('switches the preview between Classic, Steps and One at a time', async () => {
    await open('classic', [{ id: 's2', startsAt: 'company' }]);
    const preview = page.getByText('Tell us about you');
    await expect.element(preview).toBeInTheDocument();
    expect(document.querySelector('[role="progressbar"]')).toBeNull();
    await userEvent.click(page.getByText('Steps', { exact: true }).first());
    await expect
      .poll(() => document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuetext'))
      .toBe('Step 1 of 2');
    await userEvent.click(page.getByText('One at a time', { exact: true }));
    await expect
      .poll(() => document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuetext'))
      .toBe('1 of 3');
  });
});

describe('Steps as pages (AC-6303, T20)', () => {
  it('splits the form at once, after the contact details, each page under a header', async () => {
    await open('classic');
    // Classic draws no headers at all.
    expect(page.getByRole('button', { name: /^Step 1(?!.* options$)/ }).query()).toBeNull();
    await userEvent.click(page.getByText('Steps', { exact: true }).first());
    await expect.element(page.getByRole('button', { name: /^Step 1 · Your details(?!.* options$)/ })).toBeVisible();
    await expect.element(page.getByRole('button', { name: /^Step 2(?!.* options$)/ })).toBeVisible();
    // The vague Add a step is gone.
    expect(page.getByRole('button', { name: 'Add a step' }).query()).toBeNull();
    await expect
      .poll(() => document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuetext'))
      .toBe('Step 1 of 2');
  });

  it('splits at a question, renames the new page in place, and merges it back with Undo', async () => {
    await open('steps', [
      { id: 's1', startsAt: 'name' },
      { id: 's2', startsAt: 'company' },
    ]);
    // Start a new step here, from the open question's ⋯.
    await userEvent.click(page.getByRole('button', { name: /^Team size/ }));
    await userEvent.click(page.getByRole('button', { name: 'More for Team size' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Start a new step here' }));
    const title = page.getByRole('textbox', { name: 'Step title' });
    await expect.element(title).toHaveFocus();
    await userEvent.type(title, 'Your team');
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByRole('button', { name: /^Step 3 · Your team(?!.* options$)/ })).toBeVisible();
    // Merge it with the step above: one less page, and Undo brings it back.
    await userEvent.click(page.getByRole('button', { name: 'Step 3 · Your team options' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Merge with the step above' }));
    await expect.element(page.getByRole('button', { name: /^Step 3(?!.* options$)/ })).not.toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: 'Undo' }));
    await expect.element(page.getByRole('button', { name: /^Step 3 · Your team(?!.* options$)/ })).toBeVisible();
  });

  it('shows the gap’s Split here over a card on hover, never on the first question of a page', async () => {
    await open('steps', [{ id: 's1', startsAt: 'name' }]);
    // Company and Team size can be split above; Your name starts the page.
    expect(document.querySelectorAll('[class*="gap"] button').length).toBe(2);
  });

  it('keeps breaks outside Steps without saying so, and draws no headers', async () => {
    await open('classic', [{ id: 's2', title: 'More', startsAt: 'size' }]);
    expect(page.getByRole('button', { name: 'Step 2 · More', exact: true }).query()).toBeNull();
    expect(page.getByText('Only used with the Steps layout').query()).toBeNull();
  });
});

describe('the questions header at a phone’s width (spec 0058, AC-1)', () => {
  it('keeps Add a question on screen, with no sideways scroll', async () => {
    await page.viewport(390, 844);
    try {
      await open('steps', [
        { id: 's1', startsAt: 'name' },
        { id: 's2', startsAt: 'company' },
      ]);
      const add = page.getByRole('button', { name: 'Add a question' }).element();
      for (const each of [add]) {
        const box = each.getBoundingClientRect();
        expect(box.right).toBeLessThanOrEqual(390);
        expect(box.width).toBeGreaterThan(0);
      }
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    } finally {
      await page.viewport(1280, 900);
    }
  });
});
