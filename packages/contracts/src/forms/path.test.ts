import { describe, expect, it } from 'vitest';
import { checkAnswers, type CheckedForm } from './check.ts';
import { FormDocument, stepsOf, type FormDocumentInput } from './document.ts';
import { stepsOfBreaks } from './breaks.ts';
import { groupsOf, pathOf, type PathForm } from './path.ts';
import { publishProblem, type PublishAttribute } from './publish.ts';

const PEOPLE = '0199f0a0-0000-7000-8000-00000000000b';
const EMAIL = '0199f0a0-0000-7000-8000-00000000000e';

const QUESTIONS = [
  { id: 'q1', key: 'name' },
  { id: 'q2', key: 'email' },
  { id: 'q3', key: 'size' },
  { id: 'q4', key: 'budget' },
  { id: 'q5', key: 'notes' },
];

describe('stepsOfBreaks (spec 0063, AC-6303)', () => {
  it('puts the questions before the first break in a first step, and starts a step at each break', () => {
    expect(
      stepsOfBreaks(QUESTIONS, [
        { id: 's2', title: 'Your company', startsAt: 'q3' },
        { id: 's3', startsAt: 'q5' },
      ]),
    ).toEqual([
      { keys: ['name', 'email'] },
      { id: 's2', title: 'Your company', keys: ['size', 'budget'] },
      { id: 's3', keys: ['notes'] },
    ]);
  });

  it('has no lead step when a break starts at the first question, and titles it', () => {
    expect(stepsOfBreaks(QUESTIONS, [{ id: 's1', title: ' About you ', startsAt: 'q1' }])).toEqual([
      { id: 's1', title: 'About you', keys: ['name', 'email', 'size', 'budget', 'notes'] },
    ]);
  });

  it('leaves a break at the end, or two at one place, empty', () => {
    expect(
      stepsOfBreaks(QUESTIONS, [{ id: 's2', startsAt: 'q4' }, { id: 's3', startsAt: 'q4' }, { id: 's4' }]).map(
        (step) => step.keys,
      ),
    ).toEqual([['name', 'email', 'size'], [], ['budget', 'notes'], []]);
  });

  it('drops a break whose question is gone, so its questions join the step above', () => {
    expect(stepsOfBreaks(QUESTIONS, [{ id: 's2', startsAt: 'gone' }])).toEqual([
      { keys: ['name', 'email', 'size', 'budget', 'notes'] },
    ]);
  });
});

const BIG = { join: 'all', rules: [{ key: 'size', op: 'is', value: 'Large' }] } as const;

const stepped: PathForm = {
  layout: 'steps',
  questions: QUESTIONS.map(({ key }) => (key === 'notes' ? { key, showWhen: BIG } : { key })),
  steps: [
    { keys: ['name', 'email'] },
    { id: 's2', title: 'Your company', keys: ['size'] },
    { id: 's3', keys: ['budget'], showWhen: BIG },
    { id: 's4', keys: ['notes'] },
  ],
};

describe('pathOf (spec 0063, AC-6312, AC-6314)', () => {
  it('skips a step whose Show when fails, and a step left with nothing showing, without counting them', () => {
    const path = pathOf(stepped, { name: 'Ada', size: 'Small', budget: '$5k' });
    expect([...path.keys]).toEqual(['name', 'email', 'size']);
    expect(path.steps).toEqual([
      { title: undefined, keys: ['name', 'email'] },
      { id: 's2', title: 'Your company', keys: ['size'] },
    ]);
  });

  it('shows the steps once an earlier answer matches', () => {
    const path = pathOf(stepped, { size: 'large' });
    expect(path.steps.map((step) => step.keys)).toEqual([['name', 'email'], ['size'], ['budget'], ['notes']]);
  });

  it('ignores breaks and their Show when in Classic and One at a time (AC-6303)', () => {
    expect([...pathOf({ ...stepped, layout: 'classic' }, {}).keys]).toEqual(['name', 'email', 'size', 'budget']);
    expect(pathOf({ ...stepped, layout: 'classic' }, {}).steps).toHaveLength(1);
    const oneByOne = pathOf({ ...stepped, layout: 'conversational' }, { size: 'Large' });
    expect(oneByOne.steps.map((step) => step.keys)).toEqual([['name'], ['email'], ['size'], ['budget'], ['notes']]);
  });

  it('keeps every question in one step, in the form’s order, however the steps name them', () => {
    expect(
      groupsOf({
        layout: 'steps',
        questions: QUESTIONS,
        steps: [{ keys: ['email', 'name', 'name'] }, { keys: ['budget'] }],
      }).map((group) => group.keys),
    ).toEqual([
      ['name', 'email', 'size'],
      ['budget', 'notes'],
    ]);
  });
});

describe('checkAnswers on a Steps form (AC-6314)', () => {
  const form: CheckedForm = {
    language: 'en',
    layout: 'steps',
    questions: [
      { key: 'size', answerType: 'choice', required: true, choices: ['Small', 'Large'] },
      { key: 'budget', answerType: 'short_text', required: true },
    ],
    steps: [{ keys: ['size'] }, { id: 's2', keys: ['budget'], showWhen: BIG }],
  };

  it('never requires a question on a skipped step, and drops a forged answer to it', () => {
    expect(checkAnswers(form, { size: 'Small', budget: 'forged' })).toEqual({ ok: true, answers: { size: 'Small' } });
  });

  it('requires it once its step shows', () => {
    expect(checkAnswers(form, { size: 'Large' })).toEqual({ ok: false, fields: { budget: 'Answer this question.' } });
  });

  it('asks every question of the same form in Classic', () => {
    expect(checkAnswers({ ...form, layout: 'classic' }, { size: 'Small' }).ok).toBe(false);
  });
});

describe('FormDocument layout and steps (AC-6302, AC-6303)', () => {
  const base: FormDocumentInput = {
    questions: QUESTIONS.map(({ id, key }) => ({
      id,
      key,
      label: key,
      answerType: 'short_text',
      required: false,
    })),
    targets: {},
  };

  it('reads an older document as Classic with no steps', () => {
    const parsed = FormDocument.parse(base);
    expect(parsed.layout).toBe('classic');
    expect(parsed.steps).toEqual([]);
  });

  it('refuses a step at a question that is gone, steps out of order and two steps with one id', () => {
    const issues = (steps: FormDocumentInput['steps']) =>
      FormDocument.safeParse({ ...base, layout: 'steps', steps }).error?.issues.map((issue) => issue.message);
    expect(issues([{ id: 's', startsAt: 'gone' }])).toEqual([
      'A step starts at a question that is no longer on the form.',
    ]);
    expect(
      issues([
        { id: 'a', startsAt: 'q4' },
        { id: 'b', startsAt: 'q2' },
      ]),
    ).toEqual(['The steps are out of order.']);
    expect(
      issues([
        { id: 'a', startsAt: 'q2' },
        { id: 'a', startsAt: 'q4' },
      ]),
    ).toEqual(['Two steps share one id.']);
  });

  it('resolves its steps to question keys', () => {
    const parsed = FormDocument.parse({ ...base, layout: 'steps', steps: [{ id: 's2', startsAt: 'q3' }] });
    expect(stepsOf(parsed).map((step) => step.keys)).toEqual([
      ['name', 'email'],
      ['size', 'budget', 'notes'],
    ]);
  });
});

describe('publishProblem on steps (AC-6312)', () => {
  const attributes = new Map<string, PublishAttribute>([
    [EMAIL, { id: EMAIL, title: 'Email', type: 'email', objectName: 'Person', canWrite: true }],
  ]);
  const document = FormDocument.parse({
    questions: [
      { id: 'q1', key: 'size', label: 'Team size', answerType: 'choice', choices: ['Small', 'Large'], required: true },
      {
        id: 'q2',
        key: 'email',
        label: 'Work email',
        answerType: 'email',
        required: true,
        filedOn: { objectRole: 'main', attributeId: EMAIL },
      },
      { id: 'q3', key: 'notes', label: 'Anything else', answerType: 'long_text', required: false },
    ],
    targets: { main: { objectId: PEOPLE, matchAttributeId: EMAIL } },
    layout: 'steps',
  });
  const check = (steps: FormDocument['steps'], layout: FormDocument['layout'] = 'steps') =>
    publishProblem({ name: 'Demo', slug: 'demo', document: { ...document, layout, steps }, attributes });

  it('refuses a step with no questions, naming it', () => {
    expect(check([{ id: 's2', title: 'Your plans', startsAt: 'q3' }, { id: 's3' }])).toEqual({
      code: 'STEP_EMPTY',
      message: 'Step 3 has no questions. Move a question under it, or remove the step.',
      stepId: 's3',
    });
  });

  it('refuses a step’s Show when over a question that comes after it', () => {
    expect(
      check([{ id: 's2', startsAt: 'q2', showWhen: { join: 'all', rules: [{ key: 'notes', op: 'is_answered' }] } }])
        ?.message,
    ).toBe('Step 2 reads “Anything else”, which comes after it. Change its Show when.');
  });

  it('refuses a Show when on the step holding the email a submission is matched by', () => {
    expect(
      check([
        { id: 's2', startsAt: 'q2', showWhen: { join: 'all', rules: [{ key: 'size', op: 'is', value: 'Large' }] } },
      ])?.message,
    ).toBe(
      '“Work email” is how a submission becomes a person, so its step always shows. Remove the Show when on Step 2.',
    );
  });

  it('passes a Steps form whose steps stand, and never checks the breaks of another layout', () => {
    expect(check([{ id: 's2', title: 'Your plans', startsAt: 'q3' }])).toBeUndefined();
    expect(check([{ id: 's3' }], 'classic')).toBeUndefined();
  });
});
