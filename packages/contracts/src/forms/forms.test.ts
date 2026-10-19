import { describe, expect, it } from 'vitest';
import { fitsAttribute, freeKey, keyFromLabel, slugFromName, FORM_SLUG } from './answer-types.ts';
import { checkAnswers, websiteOf, type CheckedForm } from './check.ts';
import { DIAL_CODES, toE164 } from './dial-codes.ts';
import { defaultQuestions, FormDocument } from './document.ts';
import { publishProblem, type PublishAttribute } from './publish.ts';
import { COUNTRY_CODES } from '../values/countries.ts';

const PEOPLE = '0199f0a0-0000-7000-8000-00000000000b';
const EMAIL = '0199f0a0-0000-7000-8000-00000000000e';
const BUDGET = '0199f0a0-0000-7000-8000-0000000000b0';

const form: CheckedForm = {
  language: 'en',
  questions: [
    { key: 'name', answerType: 'short_text', required: true },
    { key: 'email', answerType: 'email', required: true },
    { key: 'phone', answerType: 'phone', required: false },
    { key: 'website', answerType: 'website', required: false },
    { key: 'budget', answerType: 'dropdown', required: false, choices: ['Under $1k', '$1–5k'] },
    { key: 'terms', answerType: 'checkbox', required: true },
    { key: 'news', answerType: 'yes_no', required: false },
    { key: 'country', answerType: 'country', required: false },
  ],
};

describe('checkAnswers (spec 0023, AC-553, AC-556, AC-660)', () => {
  it('answers each question in its canonical shape, and drops what the form doesn’t ask', () => {
    expect(
      checkAnswers(form, {
        name: ' Ada Lovelace ',
        email: ' ADA@Example.com ',
        phone: { number: '+44 7700 900123', country: 'GB' },
        website: 'acme.com',
        budget: '$1–5k',
        terms: true,
        country: 'United Kingdom',
        smuggled: 'drop me',
      }),
    ).toEqual({
      ok: true,
      answers: {
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        phone: { number: '+447700900123', country: 'GB' },
        website: 'https://acme.com',
        budget: '$1–5k',
        terms: true,
        news: false,
        country: 'United Kingdom',
      },
    });
  });

  it('names each question that fails, by key', () => {
    const result = checkAnswers(form, { email: 'not an email', budget: 'A million', terms: false, website: 'nope' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fields).toEqual({
      name: 'Answer this question.',
      email: 'Enter an email address, such as ada@example.com.',
      website: 'Enter a web address, such as acme.com.',
      budget: 'Pick one of the choices.',
      terms: 'Tick this to go on.',
    });
  });

  it('reads web addresses as a visitor types them', () => {
    expect(websiteOf('https://acme.com/about')).toBe('https://acme.com/about');
    expect(websiteOf('acme')).toBeUndefined();
    expect(websiteOf('javascript:alert(1)')).toBeUndefined();
  });
});

describe('the dialling codes', () => {
  it('has a code for every country, and turns a national number into E.164', () => {
    expect(
      COUNTRY_CODES.filter(
        (code) =>
          !DIAL_CODES.has(code) &&
          code !== 'AQ' &&
          code !== 'BV' &&
          code !== 'GS' &&
          code !== 'HM' &&
          code !== 'TF' &&
          code !== 'UM',
      ),
    ).toEqual([]);
    expect(toE164('GB', '07700 900123')).toBe('+447700900123');
    expect(toE164('US', '+1 415 555 0100')).toBe('+14155550100');
  });
});

describe('keys and addresses', () => {
  it('makes keys from labels, frees taken ones, and slugs from names', () => {
    expect(keyFromLabel('What is your budget?')).toBe('what_is_your_budget');
    expect(keyFromLabel('2 fast')).toBe('q_2_fast');
    expect(freeKey('company', new Set(['company', 'company_2']))).toBe('company_3');
    expect(slugFromName('Contact Us, Café!')).toBe('contact-us-cafe');
    expect(FORM_SLUG.test('form-a1b2c3')).toBe(true);
    expect(FORM_SLUG.test('-bad')).toBe(false);
  });

  it('files a name onto a name, a website onto a domain, and never a checkbox onto text', () => {
    expect(fitsAttribute('short_text', 'personal_name')).toBe(true);
    expect(fitsAttribute('website', 'domain')).toBe(true);
    expect(fitsAttribute('checkbox', 'text')).toBe(false);
  });
});

describe('FormDocument and publishProblem (AC-655)', () => {
  const document = FormDocument.parse({
    questions: defaultQuestions({ emailAttributeId: EMAIL }),
    targets: { main: { objectId: PEOPLE, matchAttributeId: EMAIL } },
  });
  const attributes = new Map<string, PublishAttribute>([
    [EMAIL, { id: EMAIL, title: 'Email addresses', type: 'email', objectName: 'Person', canWrite: true }],
    [BUDGET, { id: BUDGET, title: 'Budget band', type: 'select', objectName: 'Person', canWrite: false }],
  ]);
  const check = (changes: Partial<Parameters<typeof publishProblem>[0]>) =>
    publishProblem({ name: 'Contact us', slug: 'contact-us', document, attributes, ...changes })?.message;

  it('fills the defaults of a new form', () => {
    expect(document.headline).toBe('Fill this in and we will come back to you');
    expect(document.buttonText).toBe('Send');
    expect(document.look).toEqual({ colour: 'light', corners: 'rounded' });
    expect(document.questions.map((question) => question.key)).toEqual(['name', 'email', 'phone']);
  });

  it('refuses two questions with one key, and two on one attribute', () => {
    const [first] = document.questions;
    if (first === undefined) throw new Error('A default question.');
    expect(
      FormDocument.safeParse({ ...document, questions: [...document.questions, { ...first, id: 'other' }] }).success,
    ).toBe(false);
  });

  it('passes a good draft, and names the first problem otherwise', () => {
    expect(check({})).toBeUndefined();
    expect(check({ name: ' ' })).toBe('Give the form a name.');
    expect(check({ slug: 'A' })).toBe('The address needs 2 to 40 lowercase letters, numbers or hyphens.');
    const without = { ...document, questions: document.questions.filter((question) => question.key !== 'email') };
    expect(check({ document: without })).toBe(
      'Keep an email question. It is how an enquiry becomes a person in Timefix.',
    );
    const unlabelled = {
      ...document,
      questions: document.questions.map((question) =>
        question.key === 'phone' ? { ...question, label: '' } : question,
      ),
    };
    expect(check({ document: unlabelled })).toBe('Every question needs a label.');
    const budget = {
      id: 'budget',
      key: 'budget',
      label: 'Budget',
      answerType: 'dropdown' as const,
      choices: [],
      required: false,
      update: 'fill' as const,
    };
    expect(check({ document: { ...document, questions: [...document.questions, budget] } })).toBe(
      '“Budget” is a choice question with nothing to choose from.',
    );
    const filed = { ...budget, choices: ['Small'], filedOn: { objectRole: 'main' as const, attributeId: BUDGET } };
    expect(check({ document: { ...document, questions: [...document.questions, filed] } })).toBe(
      "You can't write to Person · Budget band, so this form can't file answers there.",
    );
    const gone = {
      ...filed,
      filedOn: { objectRole: 'main' as const, attributeId: '0199f0a0-0000-7000-8000-0000000000ff' },
    };
    expect(check({ document: { ...document, questions: [...document.questions, gone] } })).toBe(
      '“Budget” is filed on an attribute that no longer exists. Choose another in Where it goes, or Not filed.',
    );
  });
});
