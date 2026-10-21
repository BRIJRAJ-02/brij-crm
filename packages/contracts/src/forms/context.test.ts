// Tagging (spec 0023, the embeds): where a submission came from is checked
// field by field, a bad field dropped and never the lead; a site's own form
// posts choices by their stable keys and phones as typed.
import { describe, expect, it } from 'vitest';
import { choiceKeysOf, optionKeyFromLabel } from './answer-types.ts';
import { checkAnswers } from './check.ts';
import { storedContext, SubmitContext } from './context.ts';
import { countryOfE164 } from './dial-codes.ts';

describe('the submit context', () => {
  it('keeps web addresses without their credentials, and drops anything else alone', () => {
    const checked = SubmitContext.parse({
      page_url: 'https://ada:secret@acme.com/pricing',
      landing_url: 'ftp://acme.com/',
      referrer: 'not an address',
      page_title: 'Pricing\u0007',
      utm_campaign: '  spring  ',
      utm_term: 'x'.repeat(201),
      params: { plan: 'pro', 'Bad Key': 'x' },
      visitor_id: 'AbC_123-xyz_45678',
      workspace: 'ws_0123456789abcdef',
      mode: 'sideways',
      version: '1',
    });
    expect(checked).toEqual({
      page_url: 'https://acme.com/pricing',
      utm_campaign: 'spring',
      visitor_id: 'AbC_123-xyz_45678',
      workspace: 'ws_0123456789abcdef',
      version: '1',
    });
  });

  it('takes no context at all as empty, and stores it without the workspace and the script version', () => {
    expect(SubmitContext.parse('nonsense')).toEqual({});
    expect(
      storedContext(SubmitContext.parse({ mode: 'popup', workspace: 'ws_0123456789abcdef', version: '1' })),
    ).toEqual({
      mode: 'popup',
    });
  });

  it('caps the parameters a site passes at ten', () => {
    const params = Object.fromEntries(Array.from({ length: 11 }, (_, at) => [`p${String(at)}`, 'v']));
    expect(SubmitContext.parse({ params }).params).toBeUndefined();
  });
});

describe('a site’s own form', () => {
  const form = {
    language: 'en' as const,
    questions: [
      { key: 'budget', answerType: 'dropdown' as const, required: true, choices: ['Under $5k', 'Over $5k'] },
      { key: 'phone', answerType: 'phone' as const, required: false },
    ],
  };

  it('makes each choice a stable key, never two alike, and keeps a stored one', () => {
    expect(optionKeyFromLabel('Under $5k')).toBe('under_5k');
    expect(optionKeyFromLabel('!!!')).toBe('option');
    expect(choiceKeysOf({ choices: ['A b', 'A-b', 'Other'], choiceKeys: ['', 'A-b', 'else'] })).toEqual([
      'a_b',
      'a_b_2',
      'else',
    ]);
  });

  it('takes a choice by its key as the choice’s words, and a typed international phone number', () => {
    const result = checkAnswers(form, { budget: 'over_5k', phone: '+44 20 7946 0958' });
    expect(result).toEqual({
      ok: true,
      answers: { budget: 'Over $5k', phone: { number: '+442079460958', country: 'GB' } },
    });
    expect(checkAnswers(form, { budget: 'nope' }).ok).toBe(false);
    expect(checkAnswers(form, { budget: 'Under $5k', phone: '020 7946 0958' }).ok).toBe(false);
    expect(countryOfE164('+15551234567')).toBe('US');
  });
});
