import { describe, expect, it } from 'vitest';
import { checkAnswers, isEmptyAnswer, type AnswerForm } from './answers.ts';
import { FormDocument, questionsOf } from './document.ts';

const OPTION_A = '0199f0a0-0000-7000-8000-00000000000a';
const OPTION_B = '0199f0a0-0000-7000-8000-00000000000b';

/** RegExp stands in for RE2 here: the rules under test are plain. */
const pattern = (source: string, ignoreCase: boolean) => new RegExp(source, ignoreCase ? 'i' : '');

const form: AnswerForm = {
  language: 'en',
  steps: [
    {
      blocks: [
        { kind: 'heading', id: 'h', text: 'Talk to us' },
        { kind: 'question', id: 'name', label: 'Name', required: true, type: 'personal_name', isMulti: false },
        {
          kind: 'question',
          id: 'email',
          label: 'Work email',
          required: true,
          type: 'email',
          isMulti: false,
          rules: [
            {
              id: 'r1',
              kind: 'email_domain',
              params: { mode: 'block', domains: ['blocked.example'] },
              position: 0,
            },
          ],
        },
        {
          kind: 'question',
          id: 'size',
          label: 'Team size',
          required: false,
          type: 'select',
          isMulti: false,
          options: [
            { id: OPTION_A, label: 'Small' },
            { id: OPTION_B, label: 'Large' },
          ],
        },
        { kind: 'question', id: 'terms', label: 'I agree', required: true, type: 'checkbox', isMulti: false },
        { kind: 'question', id: 'notes', label: 'Notes', required: false, type: 'long_text', isMulti: false },
      ],
    },
  ],
};

describe('checkAnswers (spec 0023, AC-553, AC-556)', () => {
  it('answers each question in its canonical shape and drops unknown fields', () => {
    const result = checkAnswers(
      form,
      {
        name: { firstName: ' Ada ', lastName: 'Lovelace' },
        email: ' ADA@Example.com ',
        size: OPTION_B,
        terms: true,
        notes: '',
        smuggled: 'drop me',
      },
      { pattern },
    );
    expect(result).toEqual({
      ok: true,
      answers: {
        name: { firstName: 'Ada', lastName: 'Lovelace', fullName: 'Ada Lovelace' },
        email: 'ada@example.com',
        size: OPTION_B,
        terms: true,
      },
    });
  });

  it('names every question that fails: required, its type, its options, an unticked required box', () => {
    const result = checkAnswers(form, { email: 'not an email', size: 'b2c3', terms: false }, { pattern });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.fields).sort()).toEqual(['email', 'name', 'size', 'terms']);
    expect(result.fields.name).toBe('Answer this question.');
    expect(result.fields.terms).toBe('Tick this to go on.');
  });

  it('runs the attribute’s rules on the answer, keyed by question', () => {
    const result = checkAnswers(
      form,
      { name: { firstName: 'Ada' }, email: 'ada@blocked.example', terms: true },
      { pattern },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.fields)).toEqual(['email']);
  });

  it('treats blanks, empty lists and empty names as no answer', () => {
    expect(isEmptyAnswer('  ')).toBe(true);
    expect(isEmptyAnswer([])).toBe(true);
    expect(isEmptyAnswer({ firstName: '', lastName: ' ' })).toBe(true);
    expect(isEmptyAnswer(0)).toBe(false);
  });
});

describe('FormDocument', () => {
  it('fills its defaults and lists its questions in order', () => {
    const document = FormDocument.parse({
      steps: [
        {
          id: 'one',
          blocks: [
            {
              kind: 'question',
              id: 'email',
              label: 'Email',
              required: true,
              target: { role: 'main', attributeId: OPTION_A },
            },
            { kind: 'divider', id: 'd' },
            {
              kind: 'question',
              id: 'why',
              label: 'Why?',
              required: false,
              target: { formOnly: true, type: 'long_text' },
            },
          ],
        },
      ],
      targets: { main: { objectId: OPTION_B, matchAttributeId: OPTION_A } },
      after: { kind: 'message', text: 'Thanks.' },
      style: { title: 'Contact us' },
    });
    expect(document.owner).toEqual({ kind: 'none' });
    expect(document.spam).toEqual({ minFillMs: 2_500, scoreThreshold: 0.3 });
    expect(document.style.buttonText).toBe('Submit');
    expect(questionsOf(document).map((question) => [question.id, question.update])).toEqual([
      ['email', 'fill'],
      ['why', 'fill'],
    ]);
  });

  it('refuses a second step, a redirect that is not https, and an unknown key', () => {
    const base = {
      steps: [{ id: 'one', blocks: [] }],
      targets: { main: { objectId: OPTION_B, matchAttributeId: OPTION_A } },
      after: { kind: 'message', text: 'Thanks.' },
      style: { title: 'Contact us' },
    };
    expect(FormDocument.safeParse(base).success).toBe(true);
    expect(FormDocument.safeParse({ ...base, steps: [...base.steps, { id: 'two', blocks: [] }] }).success).toBe(false);
    expect(FormDocument.safeParse({ ...base, after: { kind: 'redirect', url: 'http://example.com' } }).success).toBe(
      false,
    );
    expect(FormDocument.safeParse({ ...base, extra: true }).success).toBe(false);
  });
});
