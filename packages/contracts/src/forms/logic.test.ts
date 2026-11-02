// Jumps, endings, points, the score and recall (spec 0063 slice 5, AC-6313, AC-6315, AC-6316, AC-6317, AC-6326).
// The three invariants the slice exists for have a test each: the path and the score come from the stored answers
// and never from the page, jumps only go forward, and a recall is plain text.
import { describe, expect, it } from 'vitest';
import { checkAnswers, type CheckedForm } from './check.ts';
import { FormDocument, type FormDocumentInput } from './document.ts';
import { pathOf, type PathForm } from './path.ts';
import { publishProblem, type PublishAttribute } from './publish.ts';
import { recall, recalledKeys } from './recall.ts';
import { pointsOf, scoreOf, type ScoreForm } from './score.ts';

const PEOPLE = '0199f0a0-0000-7000-8000-00000000000b';
const EMAIL = '0199f0a0-0000-7000-8000-00000000000e';
const SCORE = '0199f0a0-0000-7000-8000-00000000005c';
const NOTES = '0199f0a0-0000-7000-8000-00000000000a';

/** "Budget is under $1k", fresh each call, so a document's own parse is handed a list it may hold. */
const under = () => ({ join: 'all' as const, rules: [{ key: 'budget', op: 'is' as const, value: 'Under $1k' }] });

/** A three step form: budget, then the questions a fit answers, with a jump to the "Not a fit" ending. */
const jumping: PathForm = {
  layout: 'steps',
  questions: [{ key: 'budget' }, { key: 'team' }, { key: 'notes' }],
  steps: [
    { id: 's1', keys: ['budget'], jumps: [{ when: under(), to: { ending: 'no_fit' } }] },
    { id: 's2', keys: ['team'] },
    { id: 's3', keys: ['notes'] },
  ],
};

describe('pathOf with jumps (AC-6313, AC-6314)', () => {
  it('takes a matching jump to an ending and asks nothing after it', () => {
    const path = pathOf(jumping, { budget: 'Under $1k', team: '2', notes: 'hello' });
    expect([...path.keys]).toEqual(['budget']);
    expect(path.ending).toBe('no_fit');
    expect(path.steps.map((step) => step.keys)).toEqual([['budget']]);
  });

  it('goes to the next step when no jump matches, and lands on no ending', () => {
    const path = pathOf(jumping, { budget: '$10k' });
    expect([...path.keys]).toEqual(['budget', 'team', 'notes']);
    expect(path.ending).toBeUndefined();
  });

  it('skips the steps a forward jump passes over', () => {
    const form: PathForm = {
      ...jumping,
      steps: [
        { id: 's1', keys: ['budget'], jumps: [{ when: under(), to: { step: 's3' } }] },
        { id: 's2', keys: ['team'] },
        { id: 's3', keys: ['notes'] },
      ],
    };
    expect([...pathOf(form, { budget: 'Under $1k' }).keys]).toEqual(['budget', 'notes']);
  });

  it('ignores a jump backwards and one to a step the form no longer has, so a visitor can never loop', () => {
    const looping: PathForm = {
      layout: 'steps',
      questions: [{ key: 'budget' }, { key: 'team' }],
      steps: [
        { id: 's1', keys: ['budget'] },
        { id: 's2', keys: ['team'], jumps: [{ when: under(), to: { step: 's1' } }] },
      ],
    };
    const path = pathOf(looping, { budget: 'Under $1k', team: '2' });
    expect(path.steps).toHaveLength(2);
    expect([...path.keys]).toEqual(['budget', 'team']);
    const gone: PathForm = {
      ...looping,
      steps: [
        { id: 's1', keys: ['budget'], jumps: [{ when: under(), to: { step: 'removed' } }] },
        { id: 's2', keys: ['team'] },
      ],
    };
    expect([...pathOf(gone, { budget: 'Under $1k', team: '2' }).keys]).toEqual(['budget', 'team']);
  });

  it('jumps from a question with One at a time, where each question is a screen', () => {
    const form: PathForm = {
      layout: 'conversational',
      questions: [
        { key: 'budget', jumps: [{ when: under(), to: { ending: 'no_fit' } }] },
        { key: 'team' },
        { key: 'notes' },
      ],
    };
    expect(pathOf(form, { budget: 'Under $1k', team: '2' }).ending).toBe('no_fit');
    expect([...pathOf(form, { budget: '$10k' }).keys]).toEqual(['budget', 'team', 'notes']);
  });
});

describe('checkAnswers follows the same jumps (AC-6314)', () => {
  const form: CheckedForm = {
    language: 'en',
    layout: 'steps',
    questions: [
      { key: 'budget', answerType: 'choice', required: true, choices: ['Under $1k', '$10k'] },
      { key: 'team', answerType: 'short_text', required: true },
      { key: 'notes', answerType: 'long_text', required: true },
    ],
    steps: [
      { id: 's1', keys: ['budget'], jumps: [{ when: under(), to: { ending: 'no_fit' } }] },
      { id: 's2', keys: ['team'] },
      { id: 's3', keys: ['notes'] },
    ],
  };

  it('drops a forged submission’s answers to the questions the jump skipped, and requires none of them', () => {
    expect(checkAnswers(form, { budget: 'Under $1k', team: 'forged', notes: 'forged' })).toEqual({
      ok: true,
      answers: { budget: 'Under $1k' },
    });
  });

  it('still requires them when no jump matched', () => {
    expect(checkAnswers(form, { budget: '$10k' })).toEqual({
      ok: false,
      fields: { team: 'Answer this question.', notes: 'Answer this question.' },
    });
  });
});

const scored: ScoreForm = {
  questions: [
    { key: 'budget', answerType: 'choice', choices: ['Small', 'Medium', 'Large'], points: [2, 3, 5] },
    { key: 'urgent', answerType: 'yes_no', points: [4, 0] },
    { key: 'nps', answerType: 'scale', options: { from: 0 }, points: 'value' },
    { key: 'extras', answerType: 'multi_select', choices: ['A', 'B', 'C'], points: [1, 2, 3] },
    { key: 'notes', answerType: 'long_text' },
  ],
};

describe('scoreOf (AC-6316)', () => {
  it('adds a choice, a yes or no, a scale by its value and every pick of a multi select', () => {
    expect(scoreOf(scored, { budget: 'Large', urgent: true, nps: 7, extras: { picked: ['A', 'C'] } })).toBe(20);
  });

  it('adds three choices worth 2, 3 and 5 to 10, as the spec’s scenario asks', () => {
    const three: ScoreForm = {
      questions: ['a', 'b', 'c'].map((key, index) => ({
        key,
        answerType: 'choice',
        choices: ['Yes', 'No'],
        points: [[2, 3, 5][index] ?? 0, 0],
      })),
    };
    expect(scoreOf(three, { a: 'Yes', b: 'Yes', c: 'Yes' })).toBe(10);
  });

  it('scores nothing for an answer off the path, so skipped answers can never raise it', () => {
    const stepped: ScoreForm = {
      layout: 'steps',
      questions: scored.questions,
      steps: [
        {
          id: 's1',
          keys: ['budget'],
          jumps: [
            { when: { join: 'all', rules: [{ key: 'budget', op: 'is', value: 'Small' }] }, to: { ending: 'no_fit' } },
          ],
        },
        { id: 's2', keys: ['urgent', 'nps', 'extras', 'notes'] },
      ],
    };
    expect(scoreOf(stepped, { budget: 'Small', urgent: true, nps: 10, extras: { picked: ['C'] } })).toBe(2);
  });

  it('scores nothing for Other’s own words, a choice that is gone, or a type that carries no points', () => {
    const question = scored.questions[0];
    const other = scored.questions[3];
    expect(question === undefined ? 0 : pointsOf(question, 'Enormous')).toBe(0);
    expect(other === undefined ? 0 : pointsOf(other, { picked: ['A'], other: 'Something else' })).toBe(1);
    expect(pointsOf({ key: 'notes', answerType: 'long_text', points: [9] }, 'hello')).toBe(0);
  });

  it('reads a rating from its lowest star up', () => {
    expect(pointsOf({ key: 'r', answerType: 'rating', points: [0, 1, 2, 3, 4] }, 5)).toBe(4);
    expect(pointsOf({ key: 'r', answerType: 'rating', points: [0, 1, 2, 3, 4] }, 1)).toBe(0);
  });
});

describe('recall (AC-6317)', () => {
  it('reads an earlier answer and the score as plain text', () => {
    expect(recall('Thanks {{name}}, you scored {{score}}.', { answers: { name: 'Ada' }, score: 12 })).toBe(
      'Thanks Ada, you scored 12.',
    );
  });

  it('shows the angle brackets of a name that holds markup, and builds no HTML', () => {
    expect(recall('Thanks {{name}}', { answers: { name: '<b>Ada</b>' } })).toBe('Thanks <b>Ada</b>');
    expect(recall('Hi {{name}}', { answers: { name: '<img src=x onerror=alert(1)>' } })).toBe(
      'Hi <img src=x onerror=alert(1)>',
    );
  });

  it('leaves nothing where an answer has not been given yet, never its own braces', () => {
    expect(recall('Thanks {{name}}.', {})).toBe('Thanks .');
  });

  it('names the keys a text reads, each once', () => {
    expect(recalledKeys('{{name}} and {{name}} and {{ score }}')).toEqual(['name', 'score']);
  });
});

/** The three questions every publish check below is run over, each a fresh object per call. */
const budget = () => ({
  id: 'q1',
  key: 'budget',
  label: 'Budget',
  answerType: 'choice' as const,
  choices: ['Under $1k', '$10k'],
  required: true,
});
const email = () => ({
  id: 'q2',
  key: 'email',
  label: 'Work email',
  answerType: 'email' as const,
  required: true,
  filedOn: { objectRole: 'main' as const, attributeId: EMAIL },
});
const notes = () => ({
  id: 'q3',
  key: 'notes',
  label: 'Anything else',
  answerType: 'long_text' as const,
  required: false,
});

const base = (): FormDocumentInput => ({
  questions: [budget(), email(), notes()],
  targets: { main: { objectId: PEOPLE, matchAttributeId: EMAIL } },
  layout: 'steps',
  endings: [{ id: 'no_fit', heading: 'Not a fit' }],
});

const attributes = new Map<string, PublishAttribute>([
  [EMAIL, { id: EMAIL, title: 'Email', type: 'email', objectName: 'Person', canWrite: true }],
  [SCORE, { id: SCORE, title: 'Lead score', type: 'number', objectName: 'Person', canWrite: true }],
  [NOTES, { id: NOTES, title: 'Notes', type: 'text', objectName: 'Person', canWrite: true }],
]);

const check = (input: FormDocumentInput) =>
  publishProblem({ name: 'Demo', slug: 'demo', document: FormDocument.parse(input), attributes });

describe('publishProblem on a form’s logic (AC-6326)', () => {
  const second = () => ({ id: 's2', startsAt: 'q2' });
  const third = () => ({ id: 's3', startsAt: 'q3' });

  it('passes a form whose jump goes forward to an ending', () => {
    expect(
      check({ ...base(), steps: [{ ...second(), jumps: [{ when: under(), to: { ending: 'no_fit' } }] }, third()] }),
    ).toBeUndefined();
  });

  it('refuses a jump backwards, naming both steps', () => {
    const problem = check({
      ...base(),
      steps: [second(), { ...third(), jumps: [{ when: under(), to: { step: 's2' } }] }],
    });
    expect(problem?.code).toBe('JUMP_INVALID');
    expect(problem?.message).toContain('jumps back to Step 2');
    expect(problem?.message).toContain('Jumps only go forward.');
  });

  it('refuses a jump to a step, and to an ending, the form no longer has', () => {
    expect(
      check({ ...base(), steps: [{ ...second(), jumps: [{ when: under(), to: { step: 'gone' } }] }, third()] })
        ?.message,
    ).toContain('jumps to a step that is no longer on the form');
    expect(
      check({ ...base(), steps: [{ ...second(), jumps: [{ when: under(), to: { ending: 'gone' } }] }, third()] })
        ?.message,
    ).toContain('jumps to an ending that is no longer on the form');
  });

  it('refuses a jump whose condition reads a question that comes after it', () => {
    const problem = check({
      ...base(),
      steps: [
        {
          id: 's2',
          startsAt: 'q2',
          jumps: [{ when: { join: 'all', rules: [{ key: 'notes', op: 'is_answered' }] }, to: { ending: 'no_fit' } }],
        },
        third(),
      ],
    });
    expect(problem?.code).toBe('JUMP_INVALID');
    expect(problem?.message).toContain('which comes after it');
  });

  it('lets a jump compare the score', () => {
    expect(
      check({
        ...base(),
        steps: [
          {
            id: 's2',
            startsAt: 'q2',
            jumps: [
              {
                when: { join: 'all', rules: [{ key: 'score', op: 'more_than', value: '7' }] },
                to: { ending: 'no_fit' },
              },
            ],
          },
          third(),
        ],
      }),
    ).toBeUndefined();
  });

  it('refuses an ending with no heading', () => {
    expect(check({ ...base(), endings: [{ id: 'no_fit', heading: '  ' }] })).toEqual({
      code: 'ENDING_INVALID',
      message: 'Ending 1 has no heading. Give it one, or remove the ending.',
      endingId: 'no_fit',
    });
  });

  it('refuses a recall of a later question, and of one that is gone, naming both', () => {
    const later = check({
      ...base(),
      questions: [{ ...budget(), label: 'Budget for {{notes}}' }, email(), notes()],
    });
    expect(later?.code).toBe('RECALL_INVALID');
    expect(later?.message).toBe(
      '“Budget for {{notes}}” recalls “Anything else”, which comes after it, so there is nothing to recall yet. Move it earlier, or take it out of the label.',
    );
    const gone = check({
      ...base(),
      questions: [budget(), email(), { ...notes(), label: 'Anything else, {{gone}}?' }],
    });
    expect(gone?.message).toContain('is no longer a question on this form');
  });

  it('refuses an ending that recalls a question the form no longer has, and allows the score', () => {
    expect(check({ ...base(), endings: [{ id: 'no_fit', heading: 'Not a fit, {{gone}}' }] })?.code).toBe(
      'RECALL_INVALID',
    );
    expect(
      check({ ...base(), endings: [{ id: 'no_fit', heading: 'You scored {{score}}', line: 'Thanks {{budget}}' }] }),
    ).toBeUndefined();
  });

  it('refuses a score filed where a number can’t go, and allows a number field', () => {
    expect(check({ ...base(), scoreFiledOn: { objectRole: 'main', attributeId: NOTES } })?.code).toBe(
      'SCORE_FILING_INVALID',
    );
    expect(check({ ...base(), scoreFiledOn: { objectRole: 'main', attributeId: SCORE } })).toBeUndefined();
  });

  it('refuses a routing rule that goes to an ending the form no longer has', () => {
    const problem = check({
      ...base(),
      routing: { rules: [{ id: 'r1', when: under(), then: { kind: 'ending', endingId: 'gone' } }] },
    });
    expect(problem?.code).toBe('ROUTING_INVALID');
    expect(problem?.message).toContain('goes to an ending that is no longer on the form');
  });

  it('checks no jumps on a Classic form, which shows every question at once', () => {
    expect(
      check({
        ...base(),
        layout: 'classic',
        steps: [second(), { ...third(), jumps: [{ when: under(), to: { step: 's2' } }] }],
      }),
    ).toBeUndefined();
  });
});

describe('FormDocument on points and endings (AC-6315, AC-6316)', () => {
  const issues = (input: FormDocumentInput) =>
    FormDocument.safeParse(input).error?.issues.map((issue) => issue.message);

  it('reads an older document with no endings and no score filing', () => {
    const parsed = FormDocument.parse({ questions: [], targets: {} });
    // Absent, not an empty list: a document written before this spec is a form with no endings (spec notes, 1).
    expect(parsed.endings).toBeUndefined();
    expect(parsed.scoreFiledOn).toBeUndefined();
  });

  it('refuses points on a type that carries none, and more points than there are answers', () => {
    expect(
      issues({
        ...base(),
        questions: [{ ...notes(), points: [1] }, budget(), email()],
      }),
    ).toEqual(['This kind of answer can’t carry points.']);
    expect(issues({ ...base(), questions: [{ ...budget(), points: [1, 2, 3] }, email(), notes()] })).toEqual([
      'There are more points here than there are answers.',
    ]);
  });

  it('refuses the answer itself as points on anything but a rating or a scale', () => {
    expect(issues({ ...base(), questions: [{ ...budget(), points: 'value' }, email(), notes()] })).toEqual([
      'Only a rating or a scale can score the answer itself.',
    ]);
  });

  it('refuses two endings with one id, and a fifth ending', () => {
    expect(
      issues({
        ...base(),
        endings: [
          { id: 'a', heading: 'One' },
          { id: 'a', heading: 'Two' },
        ],
      }),
    ).toEqual(['Two endings share one id.']);
    expect(
      issues({ ...base(), endings: [1, 2, 3, 4, 5].map((n) => ({ id: `e${String(n)}`, heading: `E${String(n)}` })) }),
    ).toEqual(['A form holds at most 4 endings beside the default.']);
  });

  it('keeps a draft savable while a jump or a recall points at nothing, so publish is what refuses it', () => {
    expect(
      FormDocument.safeParse({
        ...base(),
        steps: [{ id: 's2', startsAt: 'q2', jumps: [{ when: under(), to: { step: 'gone' } }] }],
        questions: [{ ...budget(), label: '{{gone}}' }, email(), notes()],
      }).success,
    ).toBe(true);
  });
});
