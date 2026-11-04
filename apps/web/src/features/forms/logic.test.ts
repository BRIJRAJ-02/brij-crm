// A form's logic (T39, T41): the question a new rule reads, and rules that follow a renamed or removed choice.
import type { FormDocument, FormQuestion } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { questionFacts } from '../routing/facts.ts';
import { dropQuestionLogic, followChoices, logicUses, readyRule, ruleQuestion } from './logic.ts';

const q = (id: string, answerType: FormQuestion['answerType'], label: string, choices?: string[]): FormQuestion => ({
  id,
  key: id,
  label,
  answerType,
  required: false,
  update: 'fill',
  ...(choices === undefined ? {} : { choices }),
});

const NAME = q('name', 'short_text', 'Your name');
const EMAIL = q('email', 'email', 'Work email');
const AGREE = q('agree', 'consent', 'I agree to get emails');
const BUDGET = q('budget', 'choice', 'Budget', ['Under $1k', '$5k', '$10k+']);
const RATING = q('score', 'rating', 'How was it?');
const NOTES = q('notes', 'long_text', 'Anything else?');

const doc = (questions: readonly FormQuestion[], extra: Partial<FormDocument> = {}): FormDocument => ({
  questions: [...questions],
  targets: {},
  layout: 'classic',
  steps: [],
  look: { colour: 'light', corners: 'rounded' },
  headline: 'Talk to us',
  buttonText: 'Send',
  language: 'en',
  after: { kind: 'message', message: '' },
  routing: { rules: [] },
  spam: { minFillMs: 2_000, scoreThreshold: 0.3 },
  ...extra,
});

describe('the question a new rule reads (T39)', () => {
  it('takes the first choice question, never the consent, the name or the email', () => {
    expect(ruleQuestion([AGREE, NAME, EMAIL, NOTES, BUDGET])?.id).toBe('budget');
  });

  it('takes a number when there is no choice, then a plain question, and nothing from contact details alone', () => {
    expect(ruleQuestion([NAME, NOTES, RATING])?.id).toBe('score');
    expect(ruleQuestion([NAME, NOTES])?.id).toBe('notes');
    expect(ruleQuestion([NAME, EMAIL, AGREE])).toBeUndefined();
  });

  it('starts complete: the first real choice, or a low point on a rating', () => {
    const list = [NAME, BUDGET];
    expect(readyRule(list, questionFacts(list))).toEqual({
      join: 'all',
      rules: [{ key: 'budget', op: 'is', value: 'Under $1k' }],
    });
    expect(readyRule([RATING], questionFacts([RATING]))?.rules[0]).toEqual({
      key: 'score',
      op: 'less_than',
      value: '4',
    });
  });
});

const ruled = (value: string | string[]) =>
  doc([BUDGET, NOTES], {
    routing: {
      rules: [
        {
          id: 'r1',
          when: { join: 'all', rules: [{ key: 'budget', op: 'is', value: 'Under $1k' }] },
          then: { kind: 'redirect', url: 'https://a.example' },
        },
        {
          id: 'r2',
          when: {
            join: 'all',
            rules: [{ key: 'budget', op: 'is_any_of', value: typeof value === 'string' ? [value] : value }],
          },
          then: { kind: 'redirect', url: 'https://b.example' },
        },
      ],
    },
    questions: [
      BUDGET,
      { ...NOTES, showWhen: { join: 'all', rules: [{ key: 'budget', op: 'is', value: 'Under $1k' }] } },
    ],
  });

describe('rules follow their choices (T41)', () => {
  it('a renamed choice is renamed in every rule that names it', () => {
    const before = ruled(['Under $1k', '$5k']);
    const renamed = {
      ...before,
      questions: before.questions.map((each) =>
        each.id === 'budget' ? { ...each, choices: ['Under $2k', '$5k', '$10k+'] } : each,
      ),
    };
    const { document, dropped } = followChoices(before.questions, renamed);
    expect(dropped).toBe(0);
    expect(document.routing.rules[0]?.when.rules[0]?.value).toBe('Under $2k');
    expect(document.routing.rules[1]?.when.rules[0]?.value).toEqual(['Under $2k', '$5k']);
    expect(document.questions[1]?.showWhen?.rules[0]?.value).toBe('Under $2k');
  });

  it('a removed choice leaves a list, and a rule that only named it goes', () => {
    const before = ruled(['Under $1k', '$5k']);
    const removed = {
      ...before,
      questions: before.questions.map((each) => (each.id === 'budget' ? { ...each, choices: ['$5k', '$10k+'] } : each)),
    };
    const { document, dropped } = followChoices(before.questions, removed);
    expect(dropped).toBe(2);
    expect(document.routing.rules.map((rule) => rule.id)).toEqual(['r2']);
    expect(document.routing.rules[0]?.when.rules[0]?.value).toEqual(['$5k']);
    expect(document.questions[1]?.showWhen).toBeUndefined();
  });

  it('changes nothing, keeping the same document, when no choice changed', () => {
    const before = ruled('$5k');
    expect(followChoices(before.questions, before).document).toBe(before);
  });

  it('counts and drops the rules a deleted question was read by', () => {
    const before = ruled('$5k');
    expect(logicUses(before, 'budget')).toBe(3);
    expect(logicUses(before, 'budget', '$5k')).toBe(1);
    const { document, dropped } = dropQuestionLogic(before, 'budget');
    expect(dropped).toBe(3);
    expect(document.routing.rules).toEqual([]);
  });
});
