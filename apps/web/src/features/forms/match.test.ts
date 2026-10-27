// The email a form matches on (27 October 2026): which attribute Publish makes unique, and when it leaves well alone.
import { describe, expect, it } from 'vitest';
import type { FormAttributeChoice, FormDocument, FormTargetChoices } from '@crm/data';
import { emailToMakeUnique } from './match.ts';

const DESIGNERS = '0199f0a0-0000-7000-8000-0000000000d0';
const NAME = '0199f0a0-0000-7000-8000-0000000000d1';
const EMAIL = '0199f0a0-0000-7000-8000-0000000000d2';
const OTHER = '0199f0a0-0000-7000-8000-0000000000d3';

const draft: FormDocument = {
  questions: [
    {
      id: 'q-name',
      key: 'name',
      label: 'Your name',
      answerType: 'short_text',
      required: true,
      filedOn: { objectRole: 'main', attributeId: NAME },
      update: 'fill',
    },
    {
      id: 'q-email',
      key: 'email',
      label: 'email',
      answerType: 'email',
      required: true,
      filedOn: { objectRole: 'main', attributeId: EMAIL },
      update: 'fill',
    },
  ],
  // An object made by hand: no unique email of its own, so no match.
  targets: { main: { objectId: DESIGNERS } },
  look: { colour: 'light', corners: 'rounded' },
  headline: 'Apply',
  buttonText: 'Send',
  language: 'en',
  after: { kind: 'message', message: '' },
  routing: { rules: [] },
  spam: { minFillMs: 2_000, scoreThreshold: 0.3 },
};

const attribute = (changes: Partial<FormAttributeChoice> & Pick<FormAttributeChoice, 'attributeId'>) => ({
  title: 'email',
  type: 'email' as const,
  isRequired: false,
  isUnique: false,
  canWrite: true,
  ...changes,
});

const target = (items: readonly FormAttributeChoice[]): FormTargetChoices => ({
  objectId: DESIGNERS,
  objectName: 'Graphic Designers',
  items: [...items],
});

describe('the email a form matches on', () => {
  it('is the email question’s own attribute, made unique, when the object has no unique email', () => {
    const items = [attribute({ attributeId: NAME, title: 'Name', type: 'text' }), attribute({ attributeId: EMAIL })];
    expect(emailToMakeUnique(draft, target(items))).toBe(EMAIL);
  });

  it('is left alone when the object already has a unique email: that one is the match', () => {
    const items = [attribute({ attributeId: EMAIL }), attribute({ attributeId: OTHER, isUnique: true })];
    expect(emailToMakeUnique(draft, target(items))).toBeUndefined();
  });

  it('is never an attribute the publisher can’t change, nor anything for a form that keeps submissions only', () => {
    expect(emailToMakeUnique(draft, target([attribute({ attributeId: EMAIL, canWrite: false })]))).toBeUndefined();
    const keptOnly: FormDocument = {
      ...draft,
      targets: {},
      questions: draft.questions.map(({ filedOn: _filedOn, ...question }) => question),
    };
    expect(emailToMakeUnique(keptOnly, target([attribute({ attributeId: EMAIL })]))).toBeUndefined();
  });

  it('is nothing while the email question files nowhere', () => {
    const unfiled: FormDocument = {
      ...draft,
      questions: draft.questions.map((question) =>
        question.answerType === 'email' ? { ...question, filedOn: undefined } : question,
      ),
    };
    expect(emailToMakeUnique(unfiled, target([attribute({ attributeId: EMAIL })]))).toBeUndefined();
  });
});
