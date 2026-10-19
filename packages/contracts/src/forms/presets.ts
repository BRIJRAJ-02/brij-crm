// The questions "Add from presets" offers (spec 0023, 0023-experience.md,
// Questions): the common asks of an enquiry, worded and typed, with choices a
// member is expected to adjust. None is filed until the member says where.
import type { AnswerType } from './answer-types.ts';

/** One preset: its key, label, type, choices and placeholder. */
export interface QuestionPreset {
  readonly key: string;
  readonly label: string;
  readonly answerType: AnswerType;
  readonly choices?: readonly string[];
  readonly placeholder?: string;
}

/** The presets, in the menu's order. */
export const QUESTION_PRESETS: readonly QuestionPreset[] = [
  { key: 'company', label: 'Company', answerType: 'short_text', placeholder: 'Acme Hotels' },
  { key: 'website', label: 'Website', answerType: 'website', placeholder: 'acme.com' },
  { key: 'country', label: 'Country', answerType: 'country' },
  { key: 'address', label: 'Address', answerType: 'long_text', placeholder: 'Flat, street, city, postcode' },
  {
    key: 'service',
    label: 'What do you need?',
    answerType: 'short_text',
    placeholder: 'Brand, product design, something else',
  },
  {
    key: 'budget',
    label: 'Budget',
    answerType: 'dropdown',
    choices: ['Not sure yet', 'Under $1k', '$1–5k', '$5–15k', '$15k+'],
  },
  {
    key: 'timeframe',
    label: 'When do you want to start?',
    answerType: 'dropdown',
    choices: ['Right away', 'This quarter', 'Next quarter', 'Just exploring'],
  },
  {
    key: 'message',
    label: 'Anything else?',
    answerType: 'long_text',
    placeholder: 'What you are trying to do, and by when.',
  },
  {
    key: 'source_heard',
    label: 'How did you hear about us?',
    answerType: 'dropdown',
    choices: ['A referral', 'Search', 'Social', 'An event', 'Somewhere else'],
  },
];
