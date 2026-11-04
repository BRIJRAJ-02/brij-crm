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
    await expect.element(page.getByRole('button', { name: 'Email, answer type' })).toBeVisible();
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

  it('works by keyboard alone: the new question takes focus, then Tab goes type, Required, ⋯ and on (forms QA)', async () => {
    await show();
    // Your name open, so the new question goes under it, before Anything else?.
    (page.getByRole('button', { name: /^Your name/ }).element() as HTMLElement).focus();
    await userEvent.keyboard('{Enter}');
    const add = page.getByRole('button', { name: 'Add a question' });
    (add.element() as HTMLElement).focus();
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByRole('menu')).toBeVisible();
    await userEvent.keyboard('{Enter}');
    const words = page.getByRole('textbox', { name: 'Question', exact: true });
    await expect.element(words).toHaveFocus();
    await userEvent.keyboard('What is your budget?');
    await expect.element(words).toHaveValue('What is your budget?');
    // Shift Tab reaches its type, Tab its body and footer: Required, then its ⋯, then the next card.
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    await expect.element(page.getByRole('button', { name: /answer type$/ })).toHaveFocus();
    // Its type by the keyboard: the menu, a type picked by its first letters, and focus back on the type.
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByRole('menu')).toBeVisible();
    await userEvent.keyboard('Number');
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByRole('button', { name: 'Number, answer type' })).toHaveFocus();
    await userEvent.keyboard('{Tab}');
    await expect.element(words).toHaveFocus();
    const stops: string[] = [];
    for (let at = 0; at < 6; at += 1) {
      await userEvent.keyboard('{Tab}');
      const active = document.activeElement;
      stops.push(active?.getAttribute('aria-label') ?? active?.getAttribute('role') ?? active?.tagName ?? '');
      if (
        active?.getAttribute('role') === 'switch' ||
        (active instanceof HTMLInputElement && active.type === 'checkbox')
      ) {
        await userEvent.keyboard(' ');
        await expect.poll(() => latest.find((each) => each.label === 'What is your budget?')?.required).toBe(true);
      }
      if (active?.getAttribute('aria-label')?.startsWith('More for') === true) break;
    }
    expect(stops.at(-1)).toBe('More for What is your budget?');
    await userEvent.keyboard('{Tab}');
    // On to the next card.
    expect(document.activeElement?.closest('[role="row"]')?.textContent).toContain('Anything else?');
  });

  it('sets a Rating’s stars and the words at its ends, as a Scale’s are (critique 9)', async () => {
    await show();
    await userEvent.click(page.getByRole('button', { name: /^Your name/ }));
    await userEvent.click(page.getByRole('button', { name: 'Add a question' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Rating' }));
    await userEvent.click(page.getByRole('button', { name: /Stars/ }));
    await userEvent.click(page.getByRole('option', { name: '7' }));
    await userEvent.fill(page.getByRole('textbox', { name: 'Low end' }), 'Poor');
    await userEvent.fill(page.getByRole('textbox', { name: 'High end' }), 'Superb');
    await expect
      .poll(() => latest.find((each) => each.answerType === 'rating')?.options)
      .toEqual({ count: 7, lowLabel: 'Poor', highLabel: 'Superb' });
  });

  it('adds a quiet description under the question from its ⋯, and leaving it empty takes it away', async () => {
    await show();
    await userEvent.click(page.getByRole('button', { name: /^Anything else\?/ }));
    await userEvent.click(page.getByRole('button', { name: 'More for Anything else?' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Add a description' }));
    const line = page.getByRole('textbox', { name: 'Description' });
    await expect.element(line).toHaveFocus();
    await userEvent.fill(line, 'Anything we should know before we call.');
    await expect
      .poll(() => latest.find((each) => each.id === 'notes')?.description)
      .toBe('Anything we should know before we call.');
    // Once it has one, the menu doesn't offer another.
    await userEvent.click(page.getByRole('button', { name: 'More for Anything else?' }));
    await expect.element(page.getByRole('menuitem', { name: 'Add a description' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await userEvent.fill(line, '');
    await userEvent.keyboard('{Tab}');
    await expect.poll(() => latest.find((each) => each.id === 'notes')?.description).toBeUndefined();
  });
});
