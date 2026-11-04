// What a rule's conditions can read, and their summaries (spec 0043).
import { describe, expect, it } from 'vitest';
import type { FormQuestion } from '@crm/data';
import {
  conditionsLine,
  hiddenFieldFacts,
  isComplete,
  knownFact,
  opsFor,
  questionFacts,
  readyConditions,
  isSavable,
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

describe('Known (spec 0037, AC-1393)', () => {
  it('offers Customer only once Won means is set, under its own dotted key', () => {
    expect(knownFact(false)).toMatchObject({ key: 'crm.known', kind: 'choice' });
    expect(knownFact(false).options?.map((option) => option.id)).toEqual(['new', 'person', 'company']);
    expect(knownFact(true).options?.map((option) => option.label)).toEqual([
      'New',
      'Known person',
      'Known company',
      'Customer',
    ]);
  });
});

describe('one click rules (T15)', () => {
  const facts = questionFacts([
    question({ id: 'q1', key: 'name', label: 'Your name', answerType: 'short_text' }),
    question({ id: 'q2', key: 'size', label: 'Team size', answerType: 'choice', choices: ['1 to 10', '11 to 50'] }),
    question({ id: 'q3', key: 'notes', label: 'Anything else', answerType: 'long_text' }),
  ]);

  it('reads the last question with options and fills in its first option, ready to save', () => {
    const ready = readyConditions(facts);
    expect(ready).toEqual({ join: 'all', rules: [{ key: 'size', op: 'is', value: '1 to 10' }] });
    expect(isSavable(ready)).toBe(true);
  });

  it('prefers the step’s own questions, and gives a typed question “is answered”, complete at once', () => {
    const ready = readyConditions(facts, new Set(['notes']));
    expect(ready.rules[0]?.key).toBe('size');
    const typed = readyConditions(
      questionFacts([question({ id: 'q1', key: 'name', label: 'Your name', answerType: 'short_text' })]),
    );
    expect(typed).toEqual({ join: 'all', rules: [{ key: 'name', op: 'is_answered' }] });
    expect(isSavable(typed)).toBe(true);
  });

  it('gives a scale or a rating a real number in its lower part, never a bare “is” (T5 shots, 4 November 2026)', () => {
    const nps = questionFacts([
      question({ id: 'q1', key: 'name', label: 'Your name', answerType: 'short_text' }),
      question({
        id: 'q2',
        key: 'nps',
        label: 'How likely are you to recommend us?',
        answerType: 'scale',
        options: { from: 0, to: 10 },
      }),
    ]);
    const ready = readyConditions(nps, new Set(['nps']));
    expect(ready).toEqual({ join: 'all', rules: [{ key: 'nps', op: 'less_than', value: '7' }] });
    expect(isSavable(ready)).toBe(true);
    expect(conditionsLine(ready, nps)).toBe('How likely are you to recommend us? is less than 7');
    const stars = questionFacts([question({ id: 'q3', key: 'stars', label: 'How was it?', answerType: 'rating' })]);
    expect(readyConditions(stars).rules[0]).toEqual({ key: 'stars', op: 'less_than', value: '4' });
    // A plain number has no range to pick from: "is answered" needs no value.
    const size = questionFacts([question({ id: 'q4', key: 'size', label: 'Team size', answerType: 'number' })]);
    expect(readyConditions(size).rules[0]).toEqual({ key: 'size', op: 'is_answered' });
    // "is answered" on a required question is always true: an optional one is picked, else the rule waits for a value.
    const contact = questionFacts([
      question({ id: 'q7', key: 'email', label: 'Work email', answerType: 'email', required: true }),
      question({ id: 'q8', key: 'company', label: 'Company', answerType: 'short_text' }),
      question({ id: 'q9', key: 'name', label: 'Your name', answerType: 'short_text', required: true }),
    ]);
    expect(readyConditions(contact).rules[0]).toEqual({ key: 'company', op: 'is_answered' });
    const onlyRequired = questionFacts([
      question({ id: 'q7', key: 'email', label: 'Work email', answerType: 'email', required: true }),
    ]);
    expect(readyConditions(onlyRequired).rules[0]).toEqual({ key: 'email', op: 'is' });
    // The step's own number question wins over an earlier choice elsewhere in the form.
    const mixed = questionFacts([
      question({ id: 'q5', key: 'plan', label: 'Plan', answerType: 'choice', choices: ['Free', 'Pro'] }),
      question({ id: 'q6', key: 'nps', label: 'Score', answerType: 'scale', options: { from: 0, to: 10 } }),
    ]);
    expect(readyConditions(mixed, new Set(['nps'])).rules[0]?.key).toBe('nps');
  });

  it('never says a condition with no value: it is left out, and with none left there is no line', () => {
    const nps = questionFacts([
      question({ id: 'q2', key: 'nps', label: 'How likely?', answerType: 'scale', options: { from: 0, to: 10 } }),
      question({ id: 'q3', key: 'why', label: 'Why?', answerType: 'long_text' }),
    ]);
    expect(conditionsLine({ join: 'all', rules: [{ key: 'nps', op: 'is' }] }, nps)).toBeUndefined();
    expect(conditionsLine({ join: 'all', rules: [{ key: 'nps', op: 'is', value: ' ' }] }, nps)).toBeUndefined();
    expect(
      conditionsLine(
        {
          join: 'all',
          rules: [
            { key: 'nps', op: 'is' },
            { key: 'why', op: 'is_answered' },
          ],
        },
        nps,
      ),
    ).toBe('Why? is answered');
  });

  it('a number comparison saves only with a number', () => {
    expect(isSavable({ join: 'all', rules: [{ key: 'n', op: 'more_than', value: '7' }] })).toBe(true);
    expect(isSavable({ join: 'all', rules: [{ key: 'n', op: 'more_than', value: 'seven' }] })).toBe(false);
  });
});
