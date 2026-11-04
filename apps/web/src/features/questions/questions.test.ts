import { describe, expect, it } from 'vitest';
import type { FormAttributeChoice, FormQuestion } from '@crm/data';
import {
  addQuestion,
  changeQuestion,
  fileByLabel,
  movedPoints,
  planNewAttributes,
  renamedKeys,
  typeChange,
} from './questions.ts';

const JOB = '0199f0a0-0000-7000-8000-0000000000aa';

const role: FormQuestion = {
  id: 'q1',
  key: 'role',
  label: 'Role',
  answerType: 'short_text',
  required: false,
  update: 'fill',
};
const team: FormQuestion = {
  id: 'q2',
  key: 'team',
  label: 'Team',
  answerType: 'short_text',
  required: false,
  update: 'fill',
  showWhen: { join: 'all', rules: [{ key: 'role', op: 'is_answered' }] },
};

const attributes: readonly FormAttributeChoice[] = [
  { attributeId: JOB, title: 'Job title', type: 'text', isRequired: false, isUnique: false, canWrite: true },
];

describe('the shared question list (spec 0057)', () => {
  it('follows a key that changes with its label into every Show when, and says which keys changed', () => {
    const next = changeQuestion([role, team], 'q1', { label: 'Your job' });
    expect(next[0]?.key).toBe('your_job');
    expect(next[1]?.showWhen?.rules[0]?.key).toBe('your_job');
    expect(renamedKeys([role, team], next)).toEqual([['role', 'your_job']]);
  });

  it('keeps a live question’s key, so answers already stored keep theirs', () => {
    const next = changeQuestion([role], 'q1', { label: 'Your job' }, new Set(['q1']));
    expect(next[0]?.key).toBe('role');
  });

  it('plans an attribute for each labelled unfiled question, none while filing is off', () => {
    const list = addQuestion([role], 'q3');
    expect(planNewAttributes(list, attributes, true)).toEqual([
      { questionId: 'q1', title: 'Role', type: 'text', choices: [] },
    ]);
    expect(planNewAttributes(list, attributes, false)).toEqual([]);
    const filed = changeQuestion([role], 'q1', { filedOn: JOB });
    expect(planNewAttributes(filed, attributes, true)).toEqual([]);
  });
});

describe('Not filed, chosen (crm-f7, 28 Oct 2026)', () => {
  // Before: an unfiled question always got a field on Save, so "Not filed" could never be picked and every booking
  // question became a People column.
  const note: FormQuestion = { ...role, id: 'q3', key: 'note', label: 'Anything else?' };

  it('gives a kept question no field on Save, and still gives one to a question nobody kept', () => {
    const [kept] = changeQuestion([note], 'q3', { filedOn: null, kept: true });
    expect(kept).toMatchObject({ kept: true });
    expect(kept?.filedOn).toBeUndefined();
    expect(planNewAttributes([kept ?? note, role], attributes, true).map((plan) => plan.questionId)).toEqual(['q1']);
  });

  it('stays kept while its words change', () => {
    const [kept] = changeQuestion([note], 'q3', { kept: true });
    const [renamed] = changeQuestion([kept ?? note], 'q3', { label: 'Notes' });
    expect(renamed).toMatchObject({ kept: true, label: 'Notes' });
  });

  it('ends being kept once it is filed, or asks for a field again', () => {
    const [kept] = changeQuestion([note], 'q3', { kept: true });
    const [filed] = changeQuestion([kept ?? note], 'q3', { filedOn: JOB });
    expect(filed?.kept).toBeUndefined();
    expect(filed?.filedOn).toEqual({ objectRole: 'main', attributeId: JOB });
    const [asked] = changeQuestion([kept ?? note], 'q3', { filedOn: null, kept: false });
    expect(asked?.kept).toBeUndefined();
    expect(planNewAttributes([asked ?? note], attributes, true).map((plan) => plan.questionId)).toEqual(['q3']);
  });

  it('leaves the question a field was taken from Not filed, as the choice promised, not making a copy on Save', () => {
    const first: FormQuestion = { ...role, filedOn: { objectRole: 'main', attributeId: JOB } };
    const second: FormQuestion = { ...note, id: 'q5', key: 'job', label: 'Job' };
    const [lost, took] = changeQuestion([first, second], 'q5', { filedOn: JOB });
    expect(took?.filedOn).toEqual({ objectRole: 'main', attributeId: JOB });
    expect(lost).toMatchObject({ kept: true });
    expect(lost?.filedOn).toBeUndefined();
    expect(planNewAttributes([lost ?? first, took ?? second], attributes, true)).toEqual([]);
  });

  it('is never filed again by its label when the object changes', () => {
    const job: FormQuestion = { ...role, id: 'q4', key: 'job_title', label: 'Job title', kept: true };
    expect(fileByLabel([job], attributes)).toEqual([job]);
    const { kept: _kept, ...open } = job;
    expect(fileByLabel([open], attributes)[0]?.filedOn).toEqual({ objectRole: 'main', attributeId: JOB });
  });
});

describe('changing a filed question’s answer type (late trap #46)', () => {
  const filed = { filedOn: { objectRole: 'main' as const, attributeId: JOB } };

  it('lets go of a field the new type can’t fill, so Publish can give it one that fits', () => {
    expect(typeChange(filed, attributes, 'number')).toEqual({ answerType: 'number', filedOn: null });
  });

  it('keeps a field the new type still fills, and one the editor can’t see', () => {
    expect(typeChange(filed, attributes, 'long_text')).toEqual({ answerType: 'long_text' });
    expect(typeChange(filed, [], 'number')).toEqual({ answerType: 'number' });
    expect(typeChange({}, attributes, 'number')).toEqual({ answerType: 'number' });
  });
});

describe('points follow their choice (spec 0063, AC-6316)', () => {
  const choices = ['Small', 'Medium', 'Large'];

  it('moves a number with the choice it is on when the list is reordered', () => {
    expect(movedPoints(choices, ['Large', 'Small', 'Medium'], [2, 3, 5])).toEqual([5, 2, 3]);
  });

  it('drops the number of a choice that was removed', () => {
    expect(movedPoints(choices, ['Small', 'Large'], [2, 3, 5])).toEqual([2, 5]);
  });

  it('gives a choice added at the end no points, and keeps a renamed choice’s own', () => {
    expect(movedPoints(choices, [...choices, 'Enormous'], [2, 3, 5])).toEqual([2, 3, 5]);
    expect(movedPoints(choices, ['Small', 'Mid', 'Large'], [2, 3, 5])).toEqual([2, 3, 5]);
  });

  it('is no points at all once every number is gone', () => {
    expect(movedPoints(choices, ['Enormous'], [0, 0, 0])).toBeUndefined();
    expect(movedPoints(choices, ['Medium'], [2, 0, 5])).toBeUndefined();
  });

  it('keeps a question’s points with its choices through a change', () => {
    const question: FormQuestion = {
      id: 'q9',
      key: 'budget',
      label: 'Budget',
      answerType: 'choice',
      required: false,
      update: 'fill',
      choices,
      points: [2, 3, 5],
    };
    const [changed] = changeQuestion([question], 'q9', { choices: ['Large', 'Small', 'Medium'] });
    expect(changed?.points).toEqual([5, 2, 3]);
    const [typed] = changeQuestion([question], 'q9', { answerType: 'short_text' });
    expect(typed?.points).toBeUndefined();
  });
});

describe('a question’s description (5 November 2026)', () => {
  it('is added empty, keeps its words, and goes with null', () => {
    const list: FormQuestion[] = [
      { id: 'a', key: 'budget', label: 'Budget', answerType: 'short_text', required: false, update: 'fill' },
    ];
    const added = changeQuestion(list, 'a', { description: '' });
    expect(added[0]?.description).toBe('');
    const written = changeQuestion(added, 'a', { description: 'A rough number is fine.' });
    expect(written[0]?.description).toBe('A rough number is fine.');
    expect(changeQuestion(written, 'a', { required: true })[0]?.description).toBe('A rough number is fine.');
    expect(changeQuestion(written, 'a', { description: null })[0]).not.toHaveProperty('description');
  });
});
