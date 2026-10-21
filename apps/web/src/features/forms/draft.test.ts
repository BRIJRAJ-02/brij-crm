import { describe, expect, it } from 'vitest';
import type { FormAttributeChoice, FormDocument } from '@crm/data';
import {
  addQuestion,
  changeQuestion,
  duplicateQuestion,
  fileByLabel,
  filedLine,
  isMatchQuestion,
  moveQuestion,
  removeQuestion,
  restoreQuestion,
  sameDocument,
  statusOf,
} from './draft.ts';

const EMAIL = '0199f0a0-0000-7000-8000-00000000000e';
const NAME = '0199f0a0-0000-7000-8000-00000000000a';
const BUDGET = '0199f0a0-0000-7000-8000-0000000000bb';
const PEOPLE = '0199f0a0-0000-7000-8000-00000000000b';

const base: FormDocument = {
  questions: [
    {
      id: 'q-name',
      key: 'name',
      label: 'Your name',
      answerType: 'short_text',
      required: true,
      filedOn: { objectRole: 'main', attributeId: NAME },
      update: 'fill',
    },
    {
      id: 'q-email',
      key: 'email',
      label: 'Work email',
      answerType: 'email',
      required: true,
      filedOn: { objectRole: 'main', attributeId: EMAIL },
      update: 'fill',
    },
  ],
  targets: { main: { objectId: PEOPLE, matchAttributeId: EMAIL } },
  look: { colour: 'light', corners: 'rounded' },
  headline: 'Fill this in and we will come back to you',
  buttonText: 'Send',
  language: 'en',
  after: { kind: 'message', message: '' },
  routing: { rules: [] },
  spam: { minFillMs: 2_000, scoreThreshold: 0.3 },
};

const ATTRIBUTES: readonly FormAttributeChoice[] = [
  { attributeId: NAME, title: 'Name', type: 'personal_name', isRequired: false, isUnique: false, canWrite: true },
  { attributeId: EMAIL, title: 'Email addresses', type: 'email', isRequired: false, isUnique: true, canWrite: true },
  { attributeId: BUDGET, title: 'Budget band', type: 'select', isRequired: false, isUnique: false, canWrite: true },
];

describe('the builder’s draft changes', () => {
  it('adds an untitled short text question at the end, with a free key', () => {
    const next = addQuestion(addQuestion(base, 'q1'), 'q2');
    expect(next.questions.map((question) => question.key)).toEqual(['name', 'email', 'question', 'question_2']);
    expect(next.questions[2]).toMatchObject({ label: '', answerType: 'short_text', required: false });
  });

  it('duplicates right below, with a suffixed key and no filing', () => {
    const next = duplicateQuestion(base, 'q-name', 'q-copy');
    expect(next.questions.map((question) => question.id)).toEqual(['q-name', 'q-copy', 'q-email']);
    expect(next.questions[1]?.key).toBe('name_2');
    expect(next.questions[1]?.filedOn).toBeUndefined();
  });

  it('removes and puts back at the same place', () => {
    const { document, removed } = removeQuestion(base, 'q-name');
    expect(document.questions).toHaveLength(1);
    if (removed === undefined) throw new Error('nothing removed');
    const back = restoreQuestion(document, removed.question, removed.index);
    expect(back.questions.map((question) => question.id)).toEqual(['q-name', 'q-email']);
    expect(back.questions[0]?.filedOn?.attributeId).toBe(NAME);
  });

  it('drops a restored question’s filing when another question took it meanwhile', () => {
    const { document, removed } = removeQuestion(base, 'q-name');
    if (removed === undefined) throw new Error('nothing removed');
    const taken = changeQuestion(addQuestion(document, 'q-new'), 'q-new', { filedOn: NAME });
    const back = restoreQuestion(taken, removed.question, removed.index);
    expect(back.questions.find((question) => question.id === 'q-name')?.filedOn).toBeUndefined();
  });

  it('moves a question to a place', () => {
    expect(moveQuestion(base, 'q-email', 0).questions.map((question) => question.id)).toEqual(['q-email', 'q-name']);
  });

  it('follows the label with the key until the question goes live', () => {
    const drafted = changeQuestion(addQuestion(base, 'q1'), 'q1', { label: 'Budget band' });
    expect(drafted.questions[2]?.key).toBe('budget_band');
    const live = changeQuestion(drafted, 'q1', { label: 'Budget' }, new Set(['q1']));
    expect(live.questions[2]?.key).toBe('budget_band');
  });

  it('moves a filing from the question that held it', () => {
    const next = changeQuestion(addQuestion(base, 'q1'), 'q1', { filedOn: NAME });
    expect(next.questions[0]?.filedOn).toBeUndefined();
    expect(next.questions[2]?.filedOn?.attributeId).toBe(NAME);
  });

  it('gives a choice type an empty list of choices, for the editor blank row', () => {
    const next = changeQuestion(addQuestion(base, 'q1'), 'q1', { answerType: 'dropdown' });
    expect(next.questions[2]?.choices).toEqual([]);
  });

  it('files questions by their labels, only onto free attributes that fit', () => {
    const asked = changeQuestion(addQuestion(base, 'q1'), 'q1', { label: 'Budget band', answerType: 'dropdown' });
    const filed = fileByLabel(asked, ATTRIBUTES);
    expect(filed.questions[2]?.filedOn?.attributeId).toBe(BUDGET);
    const asText = changeQuestion(addQuestion(base, 'q2'), 'q2', { label: 'Budget band', answerType: 'email' });
    expect(fileByLabel(asText, ATTRIBUTES).questions[2]?.filedOn).toBeUndefined();
  });

  it('names where a question is filed', () => {
    const [name] = base.questions;
    if (name === undefined) throw new Error('no question');
    expect(filedLine(name, 'Person', ATTRIBUTES)).toBe('Person › Name');
    expect(filedLine({ ...name, filedOn: undefined }, 'Person', ATTRIBUTES)).toBe(
      'Not filed, kept with the submission',
    );
  });

  it('keeps the match email question', () => {
    expect(base.questions.map((question) => isMatchQuestion(base, question))).toEqual([false, true]);
  });

  it('says where the form stands', () => {
    const form = { status: 'live' as const, liveVersionNumber: 7, hasUnpublished: false };
    expect(statusOf(form, false)).toEqual({ tone: 'live', text: 'Live · v7' });
    expect(statusOf(form, true).tone).toBe('changed');
    expect(statusOf({ ...form, status: 'paused' }, false).text).toBe('Paused');
    expect(statusOf({ status: 'draft', hasUnpublished: true }, true).text).toBe('Draft');
  });

  it('compares documents whatever their key order', () => {
    const reordered = { ...base, look: { corners: 'rounded' as const, colour: 'light' as const } };
    expect(sameDocument(base, reordered)).toBe(true);
    expect(sameDocument(base, { ...base, headline: 'Hello' })).toBe(false);
  });
});

describe('Show when and routing follow a question’s key (spec 0043)', () => {
  it('a renamed draft question’s conditions read its new key, and Show when clears with null', () => {
    const withBudget: FormDocument = {
      ...base,
      questions: [
        ...base.questions,
        { id: 'q-budget', key: 'budget', label: 'Budget', answerType: 'short_text', required: false, update: 'fill' },
        {
          id: 'q-size',
          key: 'size',
          label: 'Size',
          answerType: 'number',
          required: false,
          update: 'fill',
          showWhen: { join: 'all', rules: [{ key: 'budget', op: 'is', value: 'Large' }] },
        },
      ],
      routing: {
        rules: [
          {
            id: 'r1',
            when: { join: 'all', rules: [{ key: 'budget', op: 'is_answered' }] },
            then: { kind: 'message', message: '' },
          },
        ],
      },
    };
    const renamed = changeQuestion(withBudget, 'q-budget', { label: 'Yearly budget' });
    expect(renamed.questions[3]?.showWhen?.rules[0]?.key).toBe('yearly_budget');
    expect(renamed.routing.rules[0]?.when.rules[0]?.key).toBe('yearly_budget');
    const cleared = changeQuestion(renamed, 'q-size', { showWhen: null });
    expect(cleared.questions[3]).not.toHaveProperty('showWhen');
  });
});
