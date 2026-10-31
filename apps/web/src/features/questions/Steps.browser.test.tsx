// The Layout tiles and New step dividers in Chromium (spec 0063, AC-6302, AC-6303): the tiles switch the preview,
// and a divider is added, titled and removed with Undo, with a quiet note outside Steps. Moving one is the list's
// own drag (QuestionList's keyboard story) over `moveItem` (`steps.test.ts`).
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
import type { Flow } from './steps.ts';

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
      <LayoutCard layout={layout} hasSteps={flow.steps.length > 0} isReadOnly={false} onChange={setLayout} />
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
    await userEvent.click(page.getByRole('radio', { name: 'Steps' }));
    await expect
      .poll(() => document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuetext'))
      .toBe('Step 1 of 2');
    await userEvent.click(page.getByRole('radio', { name: 'One at a time' }));
    await expect
      .poll(() => document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuetext'))
      .toBe('1 of 3');
  });
});

describe('New step dividers (AC-6303)', () => {
  it('adds one, titles it, and removes it with Undo', async () => {
    await open('steps');
    await expect.element(page.getByText('Add a step under Questions to split the form.')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Add a step' }));
    // The new divider opens at the end with its title focused.
    const title = page.getByRole('textbox', { name: 'Step title' });
    await expect.element(title).toHaveFocus();
    await userEvent.type(title, 'About your team');
    await expect.element(page.getByRole('button', { name: /^New step · About your team/ })).toBeVisible();
    await expect.element(page.getByText('No questions yet')).toBeVisible();
    // Its head closes it, as a question's does.
    await userEvent.click(page.getByRole('button', { name: /^New step · About your team/, expanded: true }));
    await expect.element(title).not.toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: /^New step · About your team/, expanded: false }));
    // The preview counts the new step only once a question is under it: one step shows no progress line.
    await expect.poll(() => document.querySelector('[role="progressbar"]')).toBeNull();
    // Remove it: its questions join the step above, and Undo brings it back.
    await userEvent.click(page.getByRole('button', { name: 'Remove step' }));
    await expect.element(page.getByRole('button', { name: /^New step/ })).not.toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: 'Undo' }));
    await expect.element(page.getByRole('button', { name: /^New step · About your team/ })).toBeVisible();
  });

  it('keeps dividers outside Steps, and says quietly that only Steps shows them', async () => {
    await open('classic', [{ id: 's2', title: 'More', startsAt: 'size' }]);
    await expect.element(page.getByText(/1 question · Shows with Steps/)).toBeVisible();
    expect(page.getByRole('button', { name: 'Add a step' }).query()).toBeNull();
  });
});
