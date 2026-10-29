import { describe, expect, it } from 'vitest';
import {
  fitsAttribute,
  freeKey,
  HONEYPOT_INPUT_NAME,
  keyFromLabel,
  QUESTION_KEY,
  slugFromName,
  FORM_SLUG,
} from './answer-types.ts';
import { checkAnswers, websiteOf, type CheckedForm } from './check.ts';
import { DIAL_CODES, toE164 } from './dial-codes.ts';
import { defaultQuestions, FormDocument, RedirectUrl } from './document.ts';
import { SubmissionView, UpdateFormSettingsInput } from './forms.ts';
import { AuditAction } from '../team.ts';
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

  it('refuses a short phone number rather than dropping it as empty, and takes the code alone as empty (QA Q82)', () => {
    const answers = { name: 'Ada', email: 'ada@example.com', terms: true };
    const short = checkAnswers(form, { ...answers, phone: { number: '+112', country: 'US' } });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(Object.keys(short.fields)).toEqual(['phone']);
    const codeOnly = checkAnswers(form, { ...answers, phone: { number: '+1', country: 'US' } });
    expect(codeOnly.ok && !('phone' in codeOnly.answers)).toBe(true);
    const plus = checkAnswers(form, { ...answers, phone: { number: ' + ', country: 'US' } });
    expect(plus.ok && !('phone' in plus.answers)).toBe(true);
    // Letters with no digits are an answer, and not a number: refused, never dropped as empty.
    const letters = checkAnswers(form, { ...answers, phone: { number: 'abc', country: 'US' } });
    expect(letters.ok).toBe(false);
    if (!letters.ok) expect(Object.keys(letters.fields)).toEqual(['phone']);
    const required = checkAnswers(
      { language: 'en', questions: [{ key: 'phone', answerType: 'phone', required: true }] },
      { phone: { number: '+9112', country: 'IN' } },
    );
    expect(required.ok).toBe(false);
    if (!required.ok) expect(required.fields.phone).not.toBe('Answer this question.');
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

  it('keeps submissions only with no target: no email needed to publish, and no answer may be filed', () => {
    const kept = FormDocument.parse({ questions: defaultQuestions({}), targets: {} });
    expect(kept.targets.main).toBeUndefined();
    expect(check({ document: kept, attributes: new Map() })).toBeUndefined();
    const withoutEmail = { ...kept, questions: kept.questions.filter((question) => question.key !== 'email') };
    expect(check({ document: withoutEmail, attributes: new Map() })).toBeUndefined();
    const filed = FormDocument.safeParse({ questions: defaultQuestions({ emailAttributeId: EMAIL }), targets: {} });
    expect(filed.success).toBe(false);
    expect(filed.error?.issues[0]?.message).toBe(
      'A form that keeps submissions only files no answers. Add submissions to the CRM first.',
    );
  });

  // Late trap #17: an object whose email isn't unique has no match, and the form refused with "File the email question
  // on X" while its email question was filed on X; a publisher who can't change attributes had no way past.
  it('says the email has to be unique, and who can make it so, when the object has nothing to match on', () => {
    const plain = new Map(attributes);
    plain.set(EMAIL, { ...attributes.get(EMAIL), title: 'Work email' } as PublishAttribute);
    const unmatched = { ...document, targets: { main: { objectId: PEOPLE } } };
    const base = { document: unmatched, attributes: plain, objectName: 'Graphic Designers' };
    expect(check({ ...base, canChangeAttributes: false })).toBe(
      'Work email on Graphic Designers isn’t unique, so a submission can’t find the record it belongs to. Ask a workspace admin to make it unique.',
    );
    expect(check({ ...base, canChangeAttributes: true })).toBe(
      'Make Work email on Graphic Designers unique. It is how a submission finds the record it belongs to, instead of adding a new one each time.',
    );
    // No email on the object at all, and the question kept off it: one has to be made first.
    const unfiled = {
      ...unmatched,
      questions: unmatched.questions.map((question) =>
        question.key === 'email' ? { ...question, filedOn: undefined } : question,
      ),
    };
    const noEmail = new Map([...plain].filter(([id]) => id !== EMAIL));
    expect(check({ document: unfiled, attributes: noEmail, objectName: 'Companies', canChangeAttributes: false })).toBe(
      'Companies has no email field to file the email question on. Ask a workspace admin to add one that is unique.',
    );
    // A field hidden from the publisher is never named, and counts as no email at all (hidden means absent).
    plain.set(EMAIL, { ...attributes.get(EMAIL), canSee: false } as PublishAttribute);
    expect(check({ ...base, attributes: plain, canChangeAttributes: false })).toBe(
      'Graphic Designers has no email field to file the email question on. Ask a workspace admin to add one that is unique.',
    );
  });

  // The owner, 27 October 2026: every submission on a Graphic Designers form failed with "A required field isn't
  // asked by this form", after the visitor had filled the whole thing in. Publishing says it first.
  it('refuses a draft whose object insists on a field no question fills', () => {
    const needed = new Map(attributes);
    needed.set(BUDGET, { ...attributes.get(BUDGET), isRequired: true, canWrite: true } as PublishAttribute);
    expect(check({ attributes: needed, objectName: 'Graphic Designers' })).toBe(
      'Budget band is required on Graphic Designers, and no question fills it, so no submission could become a record. Add a question for it, or make the field optional.',
    );
    // Filed by a question, so the form can fill it: nothing to say.
    const fills = FormDocument.parse({
      ...document,
      questions: document.questions.map((question) =>
        question.key === 'phone' ? { ...question, filedOn: { objectRole: 'main', attributeId: BUDGET } } : question,
      ),
    });
    expect(check({ document: fills, attributes: needed })).not.toContain('is required on');
    // A form that keeps its submissions only files nothing, so no field of any object can stop it.
    const kept = FormDocument.parse({ questions: defaultQuestions({}), targets: {} });
    expect(check({ document: kept, attributes: needed })).toBeUndefined();
  });

  it('passes a good draft, and names the first problem otherwise', () => {
    expect(check({})).toBeUndefined();
    expect(check({ name: ' ' })).toBe('Give the form a name.');
    expect(check({ slug: 'A' })).toBe('The address needs 2 to 40 lowercase letters, numbers or hyphens.');
    const without = { ...document, questions: document.questions.filter((question) => question.key !== 'email') };
    expect(check({ document: without })).toBe(
      'Add an email question. It is how a submission finds the People record it belongs to, instead of adding a new one each time.',
    );
    // An email question that is there but files nowhere is a different thing to be told, and it names the object it
    // would have to be filed on rather than calling every object a person (27 October 2026).
    const unfiled = {
      ...document,
      questions: document.questions.map((question) =>
        question.key === 'email' ? { ...question, filedOn: undefined } : question,
      ),
    };
    expect(check({ document: unfiled, objectName: 'Graphic Designers' })).toBe(
      'File the email question on Graphic Designers · Email addresses. It is how a submission finds the record it belongs to, instead of adding a new one each time.',
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

describe('RedirectUrl (the after sending web address)', () => {
  it('refuses a partial address with its sentence, never by throwing (it was a 500 shown as "check your connection")', () => {
    for (const partial of ['https://', 'nope', '']) {
      const parsed = RedirectUrl.safeParse(partial);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toBe('Give a full address that starts with https://.');
    }
  });

  it('takes a full https address', () => {
    expect(RedirectUrl.safeParse('https://example.com/thanks').success).toBe(true);
    expect(RedirectUrl.safeParse('http://example.com').success).toBe(false);
  });
});

describe('a form owner from a rotation (spec 0029 milestone 3, AC-755, AC-1050)', () => {
  const MEMBER = '0199f0a0-0000-7000-8000-0000000000a1';
  const ROTATION = '0199f0a0-0000-7000-8000-0000000000c1';
  const base = { workspace: 'acme', formId: '0199f0a0-0000-7000-8000-0000000000f1', mutationId: MEMBER };

  it('takes a rotation, a member, or nobody as the owner, but never a member and a rotation at once', () => {
    expect(UpdateFormSettingsInput.safeParse({ ...base, ownerRotationId: ROTATION }).success).toBe(true);
    expect(UpdateFormSettingsInput.safeParse({ ...base, ownerMemberId: MEMBER, ownerRotationId: null }).success).toBe(
      true,
    );
    expect(UpdateFormSettingsInput.safeParse({ ...base, ownerMemberId: null, ownerRotationId: null }).success).toBe(
      true,
    );
    const both = UpdateFormSettingsInput.safeParse({ ...base, ownerMemberId: MEMBER, ownerRotationId: ROTATION });
    expect(both.success).toBe(false);
    expect(both.error?.issues[0]).toMatchObject({
      path: ['ownerRotationId'],
      message: 'Pick a teammate or a round robin group as the owner, not both.',
    });
    expect(UpdateFormSettingsInput.safeParse({ ...base, ownerRotationId: 'sales' }).success).toBe(false);
  });

  it('says on a submission which rotation chose its owner, and audits a change of owner', () => {
    const assignment = SubmissionView.shape.assignment;
    expect(assignment.parse({ memberId: MEMBER, rotationId: ROTATION, reason: 'fair' })).toEqual({
      memberId: MEMBER,
      rotationId: ROTATION,
      reason: 'fair',
    });
    expect(assignment.parse({ rotationId: ROTATION, reason: 'none_available' })).toEqual({
      rotationId: ROTATION,
      reason: 'none_available',
    });
    expect(AuditAction.safeParse('form.owner_changed').success).toBe(true);
  });
});

describe('the honeypot input', () => {
  it('has a name autofill leaves alone and no question can take', () => {
    // Chrome filled `company_url` despite autocomplete="off", and real bookings were refused as bots (25 Oct 2026).
    expect(HONEYPOT_INPUT_NAME).not.toMatch(
      /company|business|organi[sz]ation|url|website|name|mail|phone|tel|address|city|zip|postal/i,
    );
    expect(QUESTION_KEY.test(HONEYPOT_INPUT_NAME)).toBe(false);
  });
});
