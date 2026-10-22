// What a rule's conditions can read, and their summaries (spec 0043).
import { describe, expect, it } from 'vitest';
import type { FormQuestion } from '@crm/data';
import {
  conditionsLine,
  hiddenFieldFacts,
  isComplete,
  opsFor,
  questionFacts,
  storedShowWhen,
  valueFor,
} from './facts.ts';

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

describe('is any of and hidden fields', () => {
  const facts = questionFacts([
    question({ id: 'b', key: 'budget', label: 'Budget', answerType: 'choice', choices: ['Small', 'Large', 'Huge'] }),
  ]);

  it('offers is any of on a choice, and keeps the value across a change of comparison', () => {
    expect(opsFor(facts[0])).toEqual(['is', 'is_any_of', 'is_not', 'is_answered', 'is_empty']);
    expect(valueFor('is_any_of', 'Large')).toEqual(['Large']);
    expect(valueFor('is', ['Large', 'Huge'])).toBe('Large');
    expect(valueFor('is_any_of', '')).toBeUndefined();
    expect(valueFor('is_empty', ['Large'])).toBeUndefined();
    const when = {
      join: 'all' as const,
      rules: [{ key: 'budget', op: 'is_any_of' as const, value: ['Large', 'Huge'] }],
    };
    expect(conditionsLine(when, facts)).toBe('Budget is any of Large or Huge');
    expect(storedShowWhen(when).rules[0]?.value).toEqual(['Large', 'Huge']);
    expect(isComplete({ join: 'all', rules: [{ key: 'budget', op: 'is_any_of', value: [] }] })).toBe(false);
  });

  it('names the visit’s hidden fields as text, and on a team page as the sending form’s', () => {
    const onForm = hiddenFieldFacts('form');
    expect(onForm.map((fact) => fact.key)).toEqual([
      'hidden.utm_source',
      'hidden.utm_medium',
      'hidden.utm_campaign',
      'hidden.utm_term',
      'hidden.utm_content',
      'hidden.page',
      'hidden.referrer',
    ]);
    expect(onForm.every((fact) => fact.kind === 'text')).toBe(true);
    expect(onForm[0]?.label).toBe('UTM source');
    expect(onForm[0]?.group).toBe('Hidden fields');
    expect(hiddenFieldFacts('page')[0]?.label).toBe('Form · UTM source');
    const when = { join: 'all' as const, rules: [{ key: 'hidden.utm_campaign', op: 'is' as const, value: 'spring' }] };
    expect(conditionsLine(when, onForm)).toBe('UTM campaign is spring');
  });
});
