// A form started from its address (spec 0023, the embeds): text questions
// take the words as given, a choice is found by its words or its key, and
// anything else starts empty, so a link can never pick a box or a file.
import type { PublicQuestion } from '@crm/contracts/forms';
import { describe, expect, it } from 'vitest';
import { prefillAnswer } from './use-hosted-form.ts';

const question = (changes: Partial<PublicQuestion>): PublicQuestion => ({
  id: 'q',
  key: 'q',
  label: 'Q',
  answerType: 'short_text',
  required: false,
  ...changes,
});

describe('a prefilled answer', () => {
  it('fills text questions with the words, trimmed and cut short', () => {
    expect(prefillAnswer(question({}), '  Ada  ')).toBe('Ada');
    expect(prefillAnswer(question({ answerType: 'email' }), 'ada@example.com')).toBe('ada@example.com');
    expect(prefillAnswer(question({}), 'x'.repeat(600))).toHaveLength(500);
    expect(prefillAnswer(question({}), '   ')).toBeUndefined();
    expect(prefillAnswer(question({}), undefined)).toBeUndefined();
  });

  it('picks a choice by its words or its key, and nothing that is neither', () => {
    const budget = question({
      answerType: 'dropdown',
      choices: ['Under $5k', 'Over $5k'],
      choiceKeys: ['under_5k', 'over_5k'],
    });
    expect(prefillAnswer(budget, 'Over $5k')).toBe('Over $5k');
    expect(prefillAnswer(budget, 'under_5k')).toBe('Under $5k');
    expect(prefillAnswer(budget, 'free')).toBeUndefined();
  });

  it('never fills a checkbox, a phone, a country or a file', () => {
    for (const answerType of ['checkbox', 'yes_no', 'phone', 'country', 'file'] as const) {
      expect(prefillAnswer(question({ answerType }), 'yes')).toBeUndefined();
    }
  });
});
