// What a rule's conditions can read, and their summaries (spec 0043).
import { describe, expect, it } from 'vitest';
import type { FormQuestion } from '@crm/data';
import { conditionsLine, isComplete, opsFor, questionFacts, storedShowWhen } from './facts.ts';

const question = (
  q: Partial<FormQuestion> & Pick<FormQuestion, 'id' | 'key' | 'label' | 'answerType'>,
): FormQuestion => ({
  required: false,
  update: 'fill',
  ...q,
});

describe('facts', () => {
  const facts = questionFacts([
    question({ id: 'b', key: 'budget', label: 'Budget', answerType: 'choice', choices: ['Small', 'Large', ''] }),
    question({ id: 's', key: 'size', label: 'Team size', answerType: 'number' }),
    question({ id: 'f', key: 'deck', label: 'Deck', answerType: 'file' }),
  ]);

  it('gives each question but a file one, with a choice’s words as its options', () => {
    expect(facts.map((fact) => [fact.key, fact.kind])).toEqual([
      ['budget', 'choice'],
      ['size', 'number'],
    ]);
    expect(facts[0]?.options?.map((option) => option.label)).toEqual(['Small', 'Large']);
    expect(opsFor(facts[1])).toContain('more_than');
  });

  it('says a rule in words, and keeps only what a comparison needs', () => {
    const when = { join: 'all' as const, rules: [{ key: 'size', op: 'more_than' as const, value: ' 50 ' }] };
    expect(conditionsLine(when, facts)).toBe('Team size is more than 50');
    expect(storedShowWhen(when).rules[0]?.value).toBe('50');
    expect(storedShowWhen({ join: 'any', rules: [{ key: 'size', op: 'is_empty', value: 'x' }] }).rules[0]).toEqual({
      key: 'size',
      op: 'is_empty',
    });
    expect(isComplete({ join: 'all', rules: [{ key: 'budget', op: 'is' }] })).toBe(false);
  });
});
