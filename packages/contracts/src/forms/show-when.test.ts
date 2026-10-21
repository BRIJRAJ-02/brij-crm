// Show when and routing conditions (spec 0043, AC-1602, AC-1614): each
// comparison, all and any, hiding that cascades, and the answer check
// dropping what a hidden question was given.
import { describe, expect, it } from 'vitest';
import { checkAnswers } from './check.ts';
import { matchesCondition, matchesShowWhen, summarizeShowWhen, visibleQuestions } from './show-when.ts';

describe('a condition', () => {
  it('compares text without case or spaces, and yes or no answers as yes and no', () => {
    expect(matchesCondition({ key: 'budget', op: 'is', value: 'large ' }, { budget: 'Large' })).toBe(true);
    expect(matchesCondition({ key: 'budget', op: 'is_not', value: 'Large' }, { budget: 'Small' })).toBe(true);
    expect(matchesCondition({ key: 'ok', op: 'is', value: 'yes' }, { ok: true })).toBe(true);
    expect(matchesCondition({ key: 'tags', op: 'is_any_of', value: ['b', 'z'] }, { tags: ['a', 'b'] })).toBe(true);
    expect(matchesCondition({ key: 'note', op: 'contains', value: 'demo' }, { note: 'Want a DEMO soon' })).toBe(true);
  });

  it('compares numbers, and never matches a missing fact except as empty', () => {
    expect(matchesCondition({ key: 'size', op: 'more_than', value: '50' }, { size: '1,200' })).toBe(true);
    expect(matchesCondition({ key: 'size', op: 'less_than', value: '50' }, { size: 'many' })).toBe(false);
    expect(matchesCondition({ key: 'size', op: 'is_not', value: '5' }, {})).toBe(false);
    expect(matchesCondition({ key: 'size', op: 'is_empty' }, {})).toBe(true);
    expect(matchesCondition({ key: 'size', op: 'is_answered' }, { size: '' })).toBe(false);
  });

  it('joins by all or any', () => {
    const when = (join: 'all' | 'any') => ({
      join,
      rules: [
        { key: 'a', op: 'is' as const, value: '1' },
        { key: 'b', op: 'is' as const, value: '2' },
      ],
    });
    expect(matchesShowWhen(when('all'), { a: '1', b: '3' })).toBe(false);
    expect(matchesShowWhen(when('any'), { a: '1', b: '3' })).toBe(true);
    expect(summarizeShowWhen(when('any'), (key) => key.toUpperCase())).toBe('A is 1 or B is 2');
  });
});

describe('Show when on questions', () => {
  const questions = [
    { key: 'budget' },
    { key: 'size', showWhen: { join: 'all' as const, rules: [{ key: 'budget', op: 'is' as const, value: 'Large' }] } },
    { key: 'seats', showWhen: { join: 'all' as const, rules: [{ key: 'size', op: 'is_answered' as const }] } },
  ];

  it('hides a question, and those that read it, when earlier answers don’t match', () => {
    expect([...visibleQuestions(questions, { budget: 'Large', size: '9' })]).toEqual(['budget', 'size', 'seats']);
    expect([...visibleQuestions(questions, { budget: 'Small', size: '9' })]).toEqual(['budget']);
  });

  it('drops a hidden question’s answer and never requires it', () => {
    const checked = checkAnswers(
      {
        language: 'en',
        questions: [
          { key: 'budget', answerType: 'choice', required: true, choices: ['Small', 'Large'] },
          {
            key: 'size',
            answerType: 'number',
            required: true,
            showWhen: { join: 'all', rules: [{ key: 'budget', op: 'is', value: 'Large' }] },
          },
        ],
      },
      { budget: 'Small', size: '12' },
    );
    expect(checked).toEqual({ ok: true, answers: { budget: 'Small' } });
  });
});
