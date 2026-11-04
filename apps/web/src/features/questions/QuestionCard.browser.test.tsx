// The question card (T40, 5 November 2026: "cluttered and not proper"; critique c, 6 and 10), in Chromium: the type
// picked first and the question put under the open one; its words typed in the card's head with the type as a small
// menu at its start; Enter goes on to the next, Escape takes back a new one never given words; one card open at a
// time; the footer is Required and one ⋯; Save answer to keeps the answer unless its words name a field there is.
import type { FormAttributeChoice, FormQuestion } from '@crm/data';
import { createToasts, type Toasts } from '@crm/ui';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import '@crm/ui/styles.css';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { QuestionsSection } from './QuestionsSection.tsx';

const EMAIL_FIELD = '0199f0a0-0000-7000-8000-0000000000e1';

const QUESTIONS: readonly FormQuestion[] = [
  { id: 'name', key: 'name', label: 'Your name', answerType: 'short_text', required: true, update: 'fill' },
  { id: 'notes', key: 'notes', label: 'Anything else?', answerType: 'long_text', required: false, update: 'fill' },
];

const ATTRIBUTES: readonly FormAttributeChoice[] = [
  { attributeId: EMAIL_FIELD, title: 'Email', type: 'email', isRequired: false, isUnique: true, canWrite: true },
];

let shown: InApp | undefined;
let ids = 0;
let latest: readonly FormQuestion[] = QUESTIONS;

beforeAll(async () => {
  await page.viewport(1280, 1000);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

function Builder({ toasts }: { readonly toasts: Toasts }) {
  const [questions, setQuestions] = useState<readonly FormQuestion[]>(QUESTIONS);
  return (
    <QuestionsSection
      questions={questions}
      onChange={(update) => {
        setQuestions((before) => {
          const next = update(before);
          latest = next;
          return next;
        });
      }}
      max={50}
      holder="A form"
      keptWith="submission"
      attributes={ATTRIBUTES}
      objectName="People"
      liveIds={new Set()}
      newId={() => `new${String((ids += 1))}`}
      toasts={toasts}
      canCreate
      isReadOnly={false}
    />
  );
}

async function show() {
  latest = QUESTIONS;
  const toasts = createToasts();
  shown = await renderInApp(() => <Builder toasts={toasts} />, {
    data: {},
    pattern: '/w/$slug/captures/forms/$formId',
    at: '/w/acme/captures/forms/form-1',
    toasts,
  });
}

describe('the question card (T40)', () => {
  it('picks the type first and puts the question under the open one, its words typed in the head', async () => {
    await show();
    await userEvent.click(page.getByRole('button', { name: /^Your name/ }));
    await userEvent.click(page.getByRole('button', { name: 'Add a question' }));
    // One Choice, grouped; no Dropdown or Multi select of their own.
    expect(page.getByRole('menuitem', { name: 'Dropdown' }).query()).toBeNull();
    await userEvent.click(page.getByRole('menuitem', { name: 'Email' }));
    const words = page.getByRole('textbox', { name: 'Question', exact: true });
    await expect.element(words).toHaveFocus();
    expect(latest.map((question) => question.answerType)).toEqual(['short_text', 'email', 'long_text']);
    // One card open at a time: Your name closed as the new one opened.
    expect(page.getByRole('button', { name: 'Close Your name' }).query()).toBeNull();
    // The type is a small menu at the head's start.
    await expect.element(page.getByRole('button', { name: 'Answer type: Email' })).toBeVisible();
    // Its words name a field the object has, so the answer goes there; nothing new is made.
    await userEvent.type(words, 'Email');
    await expect.poll(() => latest[1]?.filedOn?.attributeId).toBe(EMAIL_FIELD);
  });

  it('keeps an answer with the submission by default, and making a field is a choice in the ⋯', async () => {
    await show();
    await userEvent.click(page.getByRole('button', { name: 'Add a question' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Short text' }));
    await userEvent.type(page.getByRole('textbox', { name: 'Question', exact: true }), 'Favourite colour');
    await expect.poll(() => latest.at(-1)?.kept).toBe(true);
    // The footer is Required and one ⋯.
    await expect.element(page.getByRole('switch', { name: 'Required' })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'More for Favourite colour' }));
    await userEvent.click(page.getByRole('menuitem', { name: /^Save answer to/ }));
    await userEvent.click(page.getByRole('menuitem', { name: 'New field on People: Favourite colour' }));
    await expect.poll(() => latest.at(-1)?.kept).toBeUndefined();
  });

  it('goes on to the next question with Enter, and Escape takes back a new one never given words', async () => {
    await show();
    await userEvent.click(page.getByRole('button', { name: /^Anything else/ }));
    const words = page.getByRole('textbox', { name: 'Question', exact: true });
    await userEvent.click(words);
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => latest.length).toBe(3);
    expect(latest[2]?.answerType).toBe('long_text');
    await expect.element(page.getByRole('textbox', { name: 'Question', exact: true })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => latest.length).toBe(2);
    await expect.element(page.getByRole('button', { name: 'Add a question' })).toHaveFocus();
  });
});
