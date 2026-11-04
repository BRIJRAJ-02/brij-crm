import { describe, expect, it } from 'vitest';
import type { FormAttributeChoice, FormDocument } from '@crm/data';
import {
  addQuestion,
  canDiscard,
  firstPublish,
  firstWords,
  changeQuestion,
  draftGap,
  duplicateQuestion,
  fileByLabel,
  filedLine,
  isMatchQuestion,
  isRedirectAddress,
  moveQuestion,
  planNewAttributes,
  publishStart,
  removeQuestion,
  restoreQuestion,
  sameDocument,
  sameValue,
  savableDraft,
  statusOf,
} from './draft.ts';

const EMAIL = '0199f0a0-0000-7000-8000-00000000000e';
const NAME = '0199f0a0-0000-7000-8000-00000000000a';
const BUDGET = '0199f0a0-0000-7000-8000-0000000000bb';
const PEOPLE = '0199f0a0-0000-7000-8000-00000000000b';

const base: FormDocument = {
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
      label: 'Work email',
      answerType: 'email',
      required: true,
      filedOn: { objectRole: 'main', attributeId: EMAIL },
      update: 'fill',
    },
  ],
  targets: { main: { objectId: PEOPLE, matchAttributeId: EMAIL } },
  layout: 'classic',
  steps: [],
  look: { colour: 'light', corners: 'rounded' },
  headline: 'Fill this in and we will come back to you',
  buttonText: 'Send',
  language: 'en',
  after: { kind: 'message', message: '' },
  routing: { rules: [] },
  spam: { minFillMs: 2_000, scoreThreshold: 0.3 },
};

const ATTRIBUTES: readonly FormAttributeChoice[] = [
  { attributeId: NAME, title: 'Name', type: 'personal_name', isRequired: false, isUnique: false, canWrite: true },
  { attributeId: EMAIL, title: 'Email addresses', type: 'email', isRequired: false, isUnique: true, canWrite: true },
  { attributeId: BUDGET, title: 'Budget band', type: 'select', isRequired: false, isUnique: false, canWrite: true },
];

describe('the builder’s draft changes', () => {
  it('adds an untitled short text question at the end, with a free key', () => {
    const next = addQuestion(addQuestion(base, 'q1'), 'q2');
    expect(next.questions.map((question) => question.key)).toEqual(['name', 'email', 'question', 'question_2']);
    expect(next.questions[2]).toMatchObject({ label: '', answerType: 'short_text', required: false });
  });

  it('duplicates right below, with a suffixed key and no filing', () => {
    const next = duplicateQuestion(base, 'q-name', 'q-copy');
    expect(next.questions.map((question) => question.id)).toEqual(['q-name', 'q-copy', 'q-email']);
    expect(next.questions[1]?.key).toBe('name_2');
    expect(next.questions[1]?.filedOn).toBeUndefined();
  });

  it('removes and puts back at the same place', () => {
    const { document, removed } = removeQuestion(base, 'q-name');
    expect(document.questions).toHaveLength(1);
    if (removed === undefined) throw new Error('nothing removed');
    const back = restoreQuestion(document, removed.question, removed.index);
    expect(back.questions.map((question) => question.id)).toEqual(['q-name', 'q-email']);
    expect(back.questions[0]?.filedOn?.attributeId).toBe(NAME);
  });

  it('drops a restored question’s filing when another question took it meanwhile', () => {
    const { document, removed } = removeQuestion(base, 'q-name');
    if (removed === undefined) throw new Error('nothing removed');
    const taken = changeQuestion(addQuestion(document, 'q-new'), 'q-new', { filedOn: NAME });
    const back = restoreQuestion(taken, removed.question, removed.index);
    expect(back.questions.find((question) => question.id === 'q-name')?.filedOn).toBeUndefined();
  });

  it('moves a question to a place', () => {
    expect(moveQuestion(base, 'q-email', 0).questions.map((question) => question.id)).toEqual(['q-email', 'q-name']);
  });

  it('follows the label with the key until the question goes live', () => {
    const drafted = changeQuestion(addQuestion(base, 'q1'), 'q1', { label: 'Budget band' });
    expect(drafted.questions[2]?.key).toBe('budget_band');
    const live = changeQuestion(drafted, 'q1', { label: 'Budget' }, new Set(['q1']));
    expect(live.questions[2]?.key).toBe('budget_band');
  });

  it('moves a filing from the question that held it', () => {
    const next = changeQuestion(addQuestion(base, 'q1'), 'q1', { filedOn: NAME });
    expect(next.questions[0]?.filedOn).toBeUndefined();
    expect(next.questions[2]?.filedOn?.attributeId).toBe(NAME);
  });

  it('gives a choice type an empty list of choices, for the editor blank row', () => {
    const next = changeQuestion(addQuestion(base, 'q1'), 'q1', { answerType: 'dropdown' });
    expect(next.questions[2]?.choices).toEqual([]);
  });

  it('files questions by their labels, only onto free attributes that fit', () => {
    const asked = changeQuestion(addQuestion(base, 'q1'), 'q1', { label: 'Budget band', answerType: 'dropdown' });
    const filed = fileByLabel(asked, ATTRIBUTES);
    expect(filed.questions[2]?.filedOn?.attributeId).toBe(BUDGET);
    const asText = changeQuestion(addQuestion(base, 'q2'), 'q2', { label: 'Budget band', answerType: 'email' });
    expect(fileByLabel(asText, ATTRIBUTES).questions[2]?.filedOn).toBeUndefined();
  });

  it('names where a question is filed', () => {
    const [name] = base.questions;
    if (name === undefined) throw new Error('no question');
    expect(filedLine(name, 'Person', ATTRIBUTES)).toBe('Person › Name');
    expect(filedLine({ ...name, filedOn: undefined }, 'Person', ATTRIBUTES)).toBe('Kept with the submission only');
  });

  it('keeps the match email question', () => {
    expect(base.questions.map((question) => isMatchQuestion(base, question))).toEqual([false, true]);
  });

  it('says where the form stands', () => {
    const form = { status: 'live' as const, liveVersionNumber: 7, hasUnpublished: false };
    // Plain words: Live, never a version number.
    expect(statusOf(form, false)).toEqual({ tone: 'live', text: 'Live' });
    expect(statusOf(form, true).tone).toBe('changed');
    expect(statusOf({ ...form, status: 'paused' }, false).text).toBe('Paused');
    expect(statusOf({ status: 'draft', hasUnpublished: true }, true).text).toBe('Draft');
    // A saved draft the editor's copy matches still waits to be published, as the header's Publish changes says.
    expect(statusOf({ ...form, hasUnpublished: true }, false).tone).toBe('changed');
  });

  it('compares documents whatever their key order', () => {
    const reordered = { ...base, look: { corners: 'rounded' as const, colour: 'light' as const } };
    expect(sameDocument(base, reordered)).toBe(true);
    expect(sameDocument(base, { ...base, headline: 'Hello' })).toBe(false);
  });

  it('compares routing rules by value, so rules already live never read as waiting for publish', () => {
    const live = [{ id: 'r1', when: { key: 'size', is: 'big' }, then: { kind: 'page', pageId: 'p1' } }];
    const written = [{ then: { pageId: 'p1', kind: 'page' }, id: 'r1', when: { is: 'big', key: 'size' } }];
    expect(sameValue(live, written)).toBe(true);
    // A list's order is still a change: the first rule that matches wins.
    expect(sameValue([...live, { ...live[0], id: 'r2' }], [{ ...live[0], id: 'r2' }, ...live])).toBe(false);
  });
});

describe('a Settings field still being typed (the save that failed as "check your connection")', () => {
  const saved: FormDocument = { ...base, after: { kind: 'message', message: 'Thanks' } };

  it('knows a complete web address from a partial one', () => {
    expect(isRedirectAddress('https://example.com/thanks')).toBe(true);
    expect(isRedirectAddress('http://localhost:5173/x')).toBe(true);
    for (const partial of ['https://', '', 'https://exam', 'example.com', 'http://example.com', 'ftp://example.com']) {
      expect(isRedirectAddress(partial)).toBe(false);
    }
  });

  it('keeps the saved follow up while the address is partial, so the rest of the draft still saves', () => {
    // Choosing Another web page leaves https:// in the field, which the server refuses as a whole draft.
    const typing: FormDocument = { ...saved, headline: 'New headline', after: { kind: 'redirect', url: 'https://' } };
    const sent = savableDraft(typing, saved);
    expect(sent.after).toEqual(saved.after);
    expect(sent.headline).toBe('New headline');
    expect(draftGap(typing)).toBe('redirect');
  });

  it('sends the address once it is complete', () => {
    const done: FormDocument = { ...saved, after: { kind: 'redirect', url: 'https://example.com' } };
    expect(savableDraft(done, saved)).toBe(done);
    expect(draftGap(done)).toBeUndefined();
  });

  it('keeps the saved button words while the field is empty', () => {
    const empty: FormDocument = { ...saved, buttonText: '  ' };
    expect(savableDraft(empty, saved).buttonText).toBe(saved.buttonText);
    expect(draftGap(empty)).toBe('button');
  });
});

describe('a rule still being written is a local draft (T15)', () => {
  const two: FormDocument = {
    ...base,
    after: { kind: 'message', message: 'Thanks' },
    questions: [
      { ...base.questions[0], id: 'q1', key: 'name', label: 'Your name', answerType: 'short_text', required: true },
      { ...base.questions[0], id: 'q2', key: 'company', label: 'Company', answerType: 'short_text', required: false },
    ],
    steps: [{ id: 's2', startsAt: 'q2' }],
  } as FormDocument;

  it('leaves out a question’s Show when that has no value yet, and keeps the rest of the change', () => {
    const typing: FormDocument = {
      ...two,
      headline: 'New headline',
      questions: two.questions.map((question) =>
        question.id === 'q2'
          ? { ...question, showWhen: { join: 'all', rules: [{ key: 'name', op: 'is' }] } }
          : question,
      ),
    };
    const sent = savableDraft(typing, two);
    expect(sent.headline).toBe('New headline');
    expect(sent.questions.find((question) => question.id === 'q2')?.showWhen).toBeUndefined();
  });

  it('sends the Show when once it has its value', () => {
    const done: FormDocument = {
      ...two,
      questions: two.questions.map((question) =>
        question.id === 'q2'
          ? { ...question, showWhen: { join: 'all', rules: [{ key: 'name', op: 'is', value: 'Ada' }] } }
          : question,
      ),
    };
    expect(savableDraft(done, two)).toBe(done);
  });

  it('keeps a step’s unfinished jump and Show when out of the save, and a finished jump in', () => {
    const typing: FormDocument = {
      ...two,
      steps: [
        {
          id: 's2',
          startsAt: 'q2',
          showWhen: { join: 'all', rules: [{ key: 'name', op: 'is' }] },
          jumps: [
            { when: { join: 'all', rules: [{ key: 'name', op: 'is' }] }, to: { ending: 'e1' } },
            { when: { join: 'all', rules: [{ key: 'name', op: 'is_answered' }] }, to: { ending: 'e1' } },
            { when: { join: 'all', rules: [{ key: 'name', op: 'more_than', value: 'ten' }] }, to: { ending: 'e1' } },
          ],
        },
      ],
    };
    const [step] = savableDraft(typing, two).steps;
    expect(step?.showWhen).toBeUndefined();
    expect(step?.jumps).toEqual([
      { when: { join: 'all', rules: [{ key: 'name', op: 'is_answered' }] }, to: { ending: 'e1' } },
    ]);
  });
});

describe('Show when and routing follow a question’s key (spec 0043)', () => {
  it('a renamed draft question’s conditions read its new key, and Show when clears with null', () => {
    const withBudget: FormDocument = {
      ...base,
      questions: [
        ...base.questions,
        { id: 'q-budget', key: 'budget', label: 'Budget', answerType: 'short_text', required: false, update: 'fill' },
        {
          id: 'q-size',
          key: 'size',
          label: 'Size',
          answerType: 'number',
          required: false,
          update: 'fill',
          showWhen: { join: 'all', rules: [{ key: 'budget', op: 'is', value: 'Large' }] },
        },
      ],
      routing: {
        rules: [
          {
            id: 'r1',
            when: { join: 'all', rules: [{ key: 'budget', op: 'is_answered' }] },
            then: { kind: 'message', message: '' },
          },
        ],
      },
    };
    const renamed = changeQuestion(withBudget, 'q-budget', { label: 'Yearly budget' });
    expect(renamed.questions[3]?.showWhen?.rules[0]?.key).toBe('yearly_budget');
    expect(renamed.routing.rules[0]?.when.rules[0]?.key).toBe('yearly_budget');
    const cleared = changeQuestion(renamed, 'q-size', { showWhen: null });
    expect(cleared.questions[3]).not.toHaveProperty('showWhen');
  });
});

describe('the first publish’s start', () => {
  it('opens on the form’s name with an address made from it', () => {
    expect(publishStart('Website enquiry', 'form-dnbptb')).toEqual({
      name: 'Website enquiry',
      address: 'website-enquiry',
    });
  });

  it('leaves an untitled form’s name blank and keeps its own key', () => {
    expect(publishStart('Untitled form', 'form-dnbptb')).toEqual({ name: '', address: 'form-dnbptb' });
  });

  it('keeps the form’s key when the name makes no address', () => {
    expect(publishStart('!!', 'form-dnbptb')).toEqual({ name: '!!', address: 'form-dnbptb' });
  });
});

describe('planNewAttributes', () => {
  const doc = (questions: FormDocument['questions']): FormDocument => ({ ...base, questions });
  const ask = (id: string, label: string, answerType: FormDocument['questions'][number]['answerType'], extra = {}) => ({
    id,
    key: id,
    label,
    answerType,
    required: false,
    update: 'fill' as const,
    ...extra,
  });

  it('types from the answer type and carries a select its choices', () => {
    const plans = planNewAttributes(
      doc([ask('a', 'Website', 'website'), ask('b', 'Size', 'dropdown', { choices: ['S', ' ', 'L'] })]),
      [],
      true,
    );
    expect(plans.map((plan) => [plan.title, plan.type, plan.choices])).toEqual([
      ['Website', 'url', []],
      ['Size', 'select', ['S', 'L']],
    ]);
  });

  it('numbers a title an attribute or an earlier plan has, ignoring case', () => {
    const taken = [
      { attributeId: BUDGET, title: 'budget', type: 'number', isRequired: false, isUnique: false, canWrite: true },
    ] as const;
    const plans = planNewAttributes(doc([ask('a', 'Budget', 'number'), ask('b', 'BUDGET', 'number')]), taken, true);
    expect(plans.map((plan) => plan.title)).toEqual(['Budget 2', 'BUDGET 3']);
  });

  it('skips filed, unlabelled and file questions, and plans nothing when keeping submissions only', () => {
    const filed = ask('a', 'Name', 'short_text', { filedOn: { objectRole: 'main', attributeId: NAME } });
    const all = doc([filed, ask('b', ' ', 'short_text'), ask('c', 'CV', 'file'), ask('d', 'Notes', 'long_text')]);
    expect(planNewAttributes(all, [], true).map((plan) => [plan.title, plan.type])).toEqual([['Notes', 'text']]);
    expect(planNewAttributes(all, [], false)).toEqual([]);
  });
});

describe('the one click first publish (the owner, 5 November 2026)', () => {
  const ROLE = '0199f0a0-0000-7000-8000-0000000000c1';
  const roles: readonly FormAttributeChoice[] = [
    { attributeId: ROLE, title: 'Job title', type: 'text', isRequired: false, isUnique: false, canWrite: true },
  ];
  const asked = (document: FormDocument) =>
    changeQuestion(addQuestion(document, 'q-role'), 'q-role', { label: 'Job title', answerType: 'short_text' });

  it('matches each answer to a field by its label, with nothing asked', () => {
    const draft = asked(base);
    const first = firstPublish(draft, { name: 'Talk to us', publicKey: 'form-abc123' }, roles);
    expect(first.document.questions.find((question) => question.id === 'q-role')?.filedOn?.attributeId).toBe(ROLE);
    // A question already saved somewhere, or kept off the CRM on purpose, is left as it is.
    const kept = changeQuestion(draft, 'q-role', { filedOn: null, kept: true });
    expect(firstPublish(kept, { name: 'x', publicKey: 'form-abc123' }, roles).document.questions.at(-1)?.filedOn).toBe(
      undefined,
    );
  });

  it('keeps the form’s name and makes the link from it, or keeps its own key', () => {
    expect(firstPublish(base, { name: 'Talk to us', publicKey: 'form-abc123' }, [])).toMatchObject({
      name: 'Talk to us',
      address: 'talk-to-us',
    });
    // An untitled form goes live as it is, at its own key: renaming it later is one field in Settings.
    expect(firstPublish(base, { name: 'Untitled form', publicKey: 'form-abc123' }, [])).toMatchObject({
      name: 'Untitled form',
      address: 'form-abc123',
    });
  });
});

describe('Discard changes', () => {
  it('is offered only on a published form with something unpublished', () => {
    expect(canDiscard({ liveVersionNumber: 2, hasUnpublished: false }, true)).toBe(true);
    expect(canDiscard({ liveVersionNumber: 2, hasUnpublished: true }, false)).toBe(true);
    expect(canDiscard({ liveVersionNumber: 2, hasUnpublished: false }, false)).toBe(false);
    expect(canDiscard({ hasUnpublished: true }, true)).toBe(false);
  });
});

describe('the Flow’s ending lines', () => {
  it('shows an ending’s first words, or nothing, never a stand in like “No line”', () => {
    expect(firstWords('')).toBe('');
    expect(firstWords('  We only take   projects over $5k. ')).toBe('We only take projects over $5k.');
    expect(firstWords('one two three four five six seven eight nine ten eleven twelve thirteen')).toBe(
      'one two three four five six seven eight nine ten eleven twelve…',
    );
  });
});

describe('After they send keeps an unfinished rule or ending out of the save (T20)', () => {
  const doc = {
    ...base,
    after: { kind: 'message', message: 'Thanks' },
    endings: [{ id: 'ending_1', heading: 'Not a fit' }],
    routing: {
      rules: [
        {
          id: 'r1',
          when: { join: 'all', rules: [{ key: 'name', op: 'is_answered' }] },
          then: { kind: 'ending', endingId: 'ending_1' },
        },
      ],
    },
  } as FormDocument;

  it('waits for a link rule’s address, and blocks Publish until it has one', () => {
    const typing: FormDocument = {
      ...doc,
      routing: {
        rules: [
          ...doc.routing.rules,
          {
            id: 'r2',
            when: { join: 'all', rules: [{ key: 'name', op: 'is_answered' }] },
            then: { kind: 'redirect', url: 'https://' },
          },
        ],
      },
    };
    expect(savableDraft(typing, doc).routing.rules.map((rule) => rule.id)).toEqual(['r1']);
    expect(draftGap(typing)).toBe('route');
    const done: FormDocument = {
      ...typing,
      routing: {
        rules: typing.routing.rules.map((rule) =>
          rule.id === 'r2' ? { ...rule, then: { kind: 'redirect', url: 'https://example.com' } } : rule,
        ),
      },
    };
    expect(savableDraft(done, doc)).toBe(done);
    expect(draftGap(done)).toBeUndefined();
  });

  it('keeps a rule’s saved conditions while a new one has no value yet', () => {
    const typing: FormDocument = {
      ...doc,
      routing: {
        rules: doc.routing.rules.map((rule) => ({
          ...rule,
          when: { join: 'all', rules: [{ key: 'name', op: 'is' }] },
        })),
      },
    };
    expect(savableDraft(typing, doc).routing.rules).toEqual(doc.routing.rules);
  });

  it('leaves an ending’s half typed button out, keeping its words', () => {
    const typing: FormDocument = {
      ...doc,
      endings: [{ id: 'ending_1', heading: 'Changed', button: { kind: 'url', url: 'https://' } }],
    };
    expect(savableDraft(typing, doc).endings).toEqual([{ id: 'ending_1', heading: 'Changed' }]);
    expect(draftGap(typing)).toBe('route');
  });
});
