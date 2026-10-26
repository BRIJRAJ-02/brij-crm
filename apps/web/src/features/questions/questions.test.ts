import { describe, expect, it } from 'vitest';
import type { FormAttributeChoice, FormQuestion } from '@crm/data';
import { addQuestion, changeQuestion, planNewAttributes, renamedKeys } from './questions.ts';

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
