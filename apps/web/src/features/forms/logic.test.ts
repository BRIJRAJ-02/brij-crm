// A form's logic (T39, T41): the question a new rule reads, and rules that follow a renamed or removed choice.
import type { FormDocument, FormQuestion } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { questionFacts } from '../routing/facts.ts';
import {
  dropQuestionLogic,
  followChoices,
  logicCount,
  logicProblems,
  logicUses,
  readyRule,
  ruleQuestion,
} from './logic.ts';

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

const is = (key: string, value: string | string[], op: 'is' | 'is_any_of' = 'is') => ({
  join: 'all' as const,
  rules: [{ key, op, value }],
});
const to = (url: string) => ({ kind: 'redirect' as const, url });

describe('finding what is wrong with the logic (T41)', () => {
  it('says a rule whose value is none of the choices never matches, and one reading a gone question', () => {
    const problems = logicProblems(
      doc([BUDGET], {
        routing: {
          rules: [
            { id: 'a', when: is('budget', 'Under $2k'), then: to('https://a.example') },
            { id: 'b', when: is('gone', 'x'), then: to('https://b.example') },
          ],
        },
      }),
    );
    expect(problems).toEqual([
      { kind: 'never', place: { kind: 'rule', ruleId: 'a' } },
      { kind: 'gone', place: { kind: 'rule', ruleId: 'b' } },
    ]);
  });

  it('says one question asked to be two things at once never matches, but a multi select may be', () => {
    const two = { join: 'all' as const, rules: [...is('budget', '$5k').rules, ...is('budget', '$10k+').rules] };
    expect(
      logicProblems(doc([BUDGET], { routing: { rules: [{ id: 'a', when: two, then: to('https://a.example') }] } })),
    ).toEqual([{ kind: 'never', place: { kind: 'rule', ruleId: 'a' } }]);
    const multi = { ...BUDGET, answerType: 'multi_select' as const };
    expect(
      logicProblems(doc([multi], { routing: { rules: [{ id: 'a', when: two, then: to('https://a.example') }] } })),
    ).toEqual([]);
  });

  it('shows the conflict: the same answers twice, the first wins, and a rule after one that always matches', () => {
    const required = { ...NOTES, required: true };
    const problems = logicProblems(
      doc([BUDGET, required], {
        routing: {
          rules: [
            { id: 'a', when: is('budget', '$5k'), then: to('https://a.example') },
            { id: 'b', when: is('budget', '$5k'), then: to('https://b.example') },
            {
              id: 'c',
              when: { join: 'all', rules: [{ key: 'notes', op: 'is_answered' }] },
              then: to('https://c.example'),
            },
            { id: 'd', when: is('budget', '$10k+'), then: to('https://d.example') },
          ],
        },
      }),
    );
    expect(problems).toEqual([
      { kind: 'shadowed', place: { kind: 'rule', ruleId: 'b' }, winner: 1 },
      { kind: 'shadowed', place: { kind: 'rule', ruleId: 'd' }, winner: 3 },
    ]);
  });

  it('finds an unreachable step, a jump back up the form, and a required question some never see', () => {
    const required = { ...NOTES, required: true, showWhen: is('budget', '$5k') };
    const team = q('team', 'short_text', 'Team');
    const problems = logicProblems(
      doc([BUDGET, team, required], {
        layout: 'steps',
        steps: [
          {
            id: 's1',
            startsAt: 'budget',
            jumps: [{ when: is('budget', ['Under $1k', '$5k', '$10k+'], 'is_any_of'), to: { step: 's3' } }],
          },
          { id: 's2', startsAt: 'team', jumps: [{ when: is('budget', '$5k'), to: { step: 's1' } }] },
          { id: 's3', startsAt: 'notes' },
        ],
      }),
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        { kind: 'hiddenRequired', place: { kind: 'question', questionId: 'notes' } },
        { kind: 'unreachable', place: { kind: 'step', stepId: 's2' } },
        { kind: 'backward', place: { kind: 'jump', stepId: 's2', index: 0 } },
      ]),
    );
  });

  it('finds nothing in a form whose logic is sound, and counts every rule', () => {
    const sound = doc([BUDGET, { ...NOTES, showWhen: is('budget', '$5k') }], {
      routing: { rules: [{ id: 'a', when: is('budget', 'Under $1k'), then: to('https://a.example') }] },
    });
    expect(logicProblems(sound)).toEqual([]);
    expect(logicCount(sound)).toBe(2);
  });
});
