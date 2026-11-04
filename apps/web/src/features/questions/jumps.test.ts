// A step's jumps as the builder changes them (spec 0063, AC-6313): only forward targets are ever offered, so the
// editor cannot make the backward jump publish would refuse.
import { describe, expect, it } from 'vitest';
import type { FormQuestion } from '@crm/data';
import type { FormEnding } from '@crm/data/forms';
import {
  addJump,
  changeJump,
  idOfTarget,
  jumpChoices,
  nextQuestionName,
  nextStepName,
  questionJumpChoices,
  removeJump,
  targetOfId,
  targetWords,
} from './jumps.ts';
import { changeQuestion } from './questions.ts';
import { changeStep, stepQuestionsOf, type Flow } from './steps.ts';

const question = (id: string, key: string): FormQuestion => ({
  id,
  key,
  label: key,
  answerType: 'short_text',
  required: false,
  update: 'fill',
});

const flow: Flow = {
  questions: [question('q1', 'name'), question('q2', 'budget'), question('q3', 'team'), question('q4', 'notes')],
  steps: [
    { id: 's2', startsAt: 'q2' },
    { id: 's3', startsAt: 'q3' },
    { id: 's4', startsAt: 'q4' },
  ],
};

const endings: readonly FormEnding[] = [{ id: 'no_fit', heading: 'Not a fit' }];

const when = { join: 'all' as const, rules: [{ key: 'budget', op: 'is' as const, value: 'Under $1k' }] };

describe('jumpChoices (AC-6313)', () => {
  it('offers the steps below it and the form’s endings, never itself or one above it', () => {
    expect(jumpChoices(flow, endings, 's3').map((choice) => choice.id)).toEqual(['step:s4', 'ending:no_fit']);
  });

  it('offers an ending even to the last step, which is what an ending is for', () => {
    expect(jumpChoices(flow, endings, 's4').map((choice) => choice.id)).toEqual(['ending:no_fit']);
  });

  it('offers nothing to a form with no later step and no ending', () => {
    expect(jumpChoices(flow, [], 's4')).toEqual([]);
  });

  it('leaves out a step with no questions under it, which a visitor never sees', () => {
    const withEmpty: Flow = { ...flow, steps: [...flow.steps, { id: 's5' }] };
    expect(jumpChoices(withEmpty, [], 's3').map((choice) => choice.id)).toEqual(['step:s4']);
  });

  it('names a step by its place and an ending by its heading', () => {
    expect(jumpChoices(flow, endings, 's3').map((choice) => choice.label)).toEqual([
      'Step 4',
      'Thank-you message: Not a fit',
    ]);
  });

  it('names where a step goes when no jump matched: the next step, or nothing at the last (the thank you)', () => {
    expect(nextStepName(flow, 's3')).toBe('Step 4');
    expect(nextStepName(flow, 's4')).toBeUndefined();
  });
});

describe('a jump’s target and its words', () => {
  it('reads a target to the picker’s id and back', () => {
    expect(idOfTarget({ step: 's4' })).toBe('step:s4');
    expect(idOfTarget({ ending: 'no_fit' })).toBe('ending:no_fit');
    expect(targetOfId('step:s4')).toEqual({ step: 's4' });
    expect(targetOfId('ending:no_fit')).toEqual({ ending: 'no_fit' });
    expect(targetOfId('something')).toBeUndefined();
  });

  it('has no words for a target the form no longer has, which the row says is gone', () => {
    const choices = jumpChoices(flow, endings, 's3');
    expect(targetWords({ step: 's4' }, choices)).toBe('Step 4');
    expect(targetWords({ step: 'removed' }, choices)).toBeUndefined();
  });
});

describe('a step’s jumps as a list', () => {
  it('adds, changes and removes one, and adds nothing with nowhere to go', () => {
    const one = addJump([], { ending: 'no_fit' }, when);
    expect(one).toEqual([{ when, to: { ending: 'no_fit' } }]);
    expect(addJump(one, undefined, when)).toEqual(one);
    expect(changeJump(one, 0, { to: { step: 's4' } })).toEqual([{ when, to: { step: 's4' } }]);
    expect(removeJump(one, 0)).toEqual([]);
  });

  it('keeps the jumps on the step they belong to, and an empty list is no jumps at all', () => {
    const jumps = [{ when, to: { ending: 'no_fit' } as const }];
    const changed = changeStep(flow, 's3', { jumps });
    expect(changed.steps.find((step) => step.id === 's3')?.jumps).toEqual(jumps);
    expect(changed.steps.find((step) => step.id === 's2')?.jumps).toBeUndefined();
    expect(changeStep(changed, 's3', { jumps: [] }).steps.find((step) => step.id === 's3')?.jumps).toBeUndefined();
  });

  it('keeps a step’s jumps when its title changes', () => {
    const jumps = [{ when, to: { ending: 'no_fit' } as const }];
    const titled = changeStep(changeStep(flow, 's3', { jumps }), 's3', { title: 'Your plans' });
    expect(titled.steps.find((step) => step.id === 's3')).toMatchObject({ title: 'Your plans', jumps });
  });
});

describe('stepQuestionsOf (AC-6313)', () => {
  it('gives a step’s own questions, which its jumps read along with everything before them', () => {
    expect(stepQuestionsOf(flow, 's3').map((each) => each.key)).toEqual(['team']);
    expect(stepQuestionsOf(flow, 'gone')).toEqual([]);
  });
});

describe('One at a time: a question’s rules (AC-6313)', () => {
  const hidden: FormQuestion = { ...question('q5', 'ref'), answerType: 'hidden' };
  const questions = [...flow.questions, hidden];
  const endings: FormEnding[] = [{ id: 'e1', heading: 'Not a fit' }];

  it('offers only the questions below it a visitor sees, by place and words, then the endings', () => {
    expect(questionJumpChoices(questions, endings, 'q2')).toEqual([
      { id: 'step:team', label: 'Question 3 · team' },
      { id: 'step:notes', label: 'Question 4 · notes' },
      { id: 'ending:e1', label: 'Thank-you message: Not a fit' },
    ]);
  });

  it('names the next question as where everyone else goes, and none after the last', () => {
    expect(nextQuestionName(questions, 'q2')).toBe('Question 3 · team');
    expect(nextQuestionName(questions, 'q4')).toBeUndefined();
  });

  it('follows a renamed question: its rules read and go to the new key', () => {
    const ruled: FormQuestion[] = [
      { ...question('a', 'budget'), label: 'Budget' },
      {
        ...question('b', 'role'),
        jumps: [{ when: { join: 'all', rules: [{ key: 'budget', op: 'is_answered' }] }, to: { step: 'notes' } }],
      },
      question('c', 'notes'),
    ];
    const renamed = changeQuestion(ruled, 'c', { label: 'Anything else' });
    expect(renamed[1]?.jumps?.[0]?.to).toEqual({ step: 'anything_else' });
    const reread = changeQuestion(renamed, 'a', { label: 'Spend' });
    expect(reread[1]?.jumps?.[0]?.when.rules[0]?.key).toBe('spend');
    expect(changeQuestion(reread, 'b', { jumps: null })[1]?.jumps).toBeUndefined();
  });
});
