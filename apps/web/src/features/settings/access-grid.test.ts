import type { ObjectAccess, RuleSubject } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { expected, fieldChoices, fieldState, keyOf, limitedCount, withField } from './access-grid.ts';

const OBJECT = '00000000-0000-7000-8000-00000000000a';
const SALES = '00000000-0000-7000-8000-0000000000c1';
const SUPPORT = '00000000-0000-7000-8000-0000000000c2';
const MEMBER: RuleSubject = { type: 'role', role: 'member' };
const team = (teamId: string): RuleSubject => ({ type: 'team', teamId });

const SALARY = '00000000-0000-7000-8000-0000000000f1';
const NAME = '00000000-0000-7000-8000-0000000000f2';
const FIELDS = [
  { id: NAME, title: 'Name', isPrimary: true },
  { id: SALARY, title: 'Salary', isPrimary: false },
];

const start: ObjectAccess = {
  objectId: OBJECT,
  fields: FIELDS,
  subjects: [
    { subject: MEMBER, level: 'write', records: 'all', defaultLevel: 'write', isDefault: true, fields: {}, people: 4 },
  ],
};

describe('what the grid shows before the server answers', () => {
  it('keeps a role and each team apart', () => {
    expect(new Set([keyOf(MEMBER), keyOf(team(SALES)), keyOf(team(SUPPORT))]).size).toBe(3);
  });

  it('shows the Member role changed, and back at its default when it is put back', () => {
    const none = expected(start, MEMBER, { level: 'none', records: 'all' });
    expect(none.subjects).toEqual([
      {
        subject: MEMBER,
        level: 'none',
        records: 'all',
        defaultLevel: 'write',
        isDefault: false,
        fields: {},
        people: 4,
      },
    ]);
    expect(expected(none, MEMBER, null).subjects).toEqual(start.subjects);
    // Saying the default out loud is the default too.
    expect(expected(none, MEMBER, { level: 'write', records: 'all' }).subjects).toEqual(start.subjects);
    // Edit on their own records is a rule, not the default.
    expect(expected(start, MEMBER, { level: 'write', records: 'own' }).subjects[0]).toMatchObject({
      records: 'own',
      isDefault: false,
    });
  });

  it('adds a team among the teams by name, after the roles, and keeps a row where it is on a change', () => {
    const names = new Map([
      [SALES, 'Sales'],
      [SUPPORT, 'Support'],
    ]);
    // Support first, then Sales: Sales goes before it, as the server's answer will put it.
    const support = expected(start, team(SUPPORT), { level: 'read', records: 'own' }, names);
    const two = expected(support, team(SALES), { level: 'write', records: 'all' }, names);
    expect(two.subjects.map((each) => each.subject)).toEqual([MEMBER, team(SALES), team(SUPPORT)]);
    expect(two.subjects[1]).toMatchObject({ level: 'write', defaultLevel: 'none', isDefault: false, people: 0 });
    // A change to a team that is there is made where it stands: the focused row doesn't move.
    const changed = expected(two, team(SALES), { level: 'read', records: 'all' }, names);
    expect(changed.subjects.map((each) => each.subject)).toEqual([MEMBER, team(SALES), team(SUPPORT)]);
    expect(changed.subjects[1]).toMatchObject({ level: 'read' });
    // And a change to the role never moves it below a team.
    expect(
      expected(changed, MEMBER, { level: 'read', records: 'all' }, names).subjects.map((each) => each.subject),
    ).toEqual([MEMBER, team(SALES), team(SUPPORT)]);
  });

  it('removes a team with no access, or with its rule cleared, and leaves the rest', () => {
    const two = expected(expected(start, team(SALES), { level: 'write', records: 'all' }), team(SUPPORT), {
      level: 'read',
      records: 'all',
    });
    expect(expected(two, team(SALES), null).subjects.map((each) => each.subject)).toEqual([MEMBER, team(SUPPORT)]);
    expect(
      expected(two, team(SUPPORT), { level: 'none', records: 'all' }).subjects.map((each) => each.subject),
    ).toEqual([MEMBER, team(SALES)]);
  });

  it('changes nothing it was not given', () => {
    const before = JSON.stringify(start);
    expected(start, MEMBER, { level: 'none', records: 'all' });
    expect(JSON.stringify(start)).toBe(before);
  });
});

describe('field rules in the grid (AC-846, AC-856)', () => {
  it('keeps a subject’s field rules through a change that leaves them out, and drops them with the rule', () => {
    const hidden = expected(start, MEMBER, { level: 'write', records: 'all', fields: { [SALARY]: 'hidden' } });
    expect(hidden.subjects[0]).toMatchObject({ isDefault: false, fields: { [SALARY]: 'hidden' } });
    // A level change that names no fields leaves them be.
    expect(expected(hidden, MEMBER, { level: 'read', records: 'all' }).subjects[0]).toMatchObject({
      level: 'read',
      fields: { [SALARY]: 'hidden' },
    });
    expect(expected(hidden, MEMBER, null).subjects).toEqual(start.subjects);
    // Taking the last field rule away puts the role back at its default.
    expect(expected(hidden, MEMBER, { level: 'write', records: 'all', fields: {} }).subjects).toEqual(start.subjects);
  });

  it('reads a field’s state from its rule, never above the object', () => {
    expect(fieldState('write', {}, SALARY)).toBe('visible');
    expect(fieldState('write', { [SALARY]: 'read' }, SALARY)).toBe('read');
    expect(fieldState('write', { [SALARY]: 'hidden' }, SALARY)).toBe('hidden');
    // View makes every field read only; none makes them all absent.
    expect(fieldState('read', {}, SALARY)).toBe('read');
    expect(fieldState('read', { [SALARY]: 'hidden' }, SALARY)).toBe('hidden');
    expect(fieldState('none', {}, SALARY)).toBe('hidden');
  });

  it('sets and clears one field without touching the others, or the object it came from', () => {
    const rules = { [NAME]: 'read' } as const;
    const set = withField(rules, SALARY, 'hidden');
    expect(set).toEqual({ [NAME]: 'read', [SALARY]: 'hidden' });
    expect(rules).toEqual({ [NAME]: 'read' });
    expect(withField(set, SALARY, 'visible')).toEqual({ [NAME]: 'read' });
  });

  it('offers a field the states it can be in: the record’s name is never hidden, and a viewer has no Visible', () => {
    const [name, salary] = FIELDS;
    if (name === undefined || salary === undefined) throw new Error('Two fields.');
    expect(fieldChoices('write', salary)).toEqual(['visible', 'read', 'hidden']);
    expect(fieldChoices('write', name)).toEqual(['visible', 'read']);
    expect(fieldChoices('read', salary)).toEqual(['read', 'hidden']);
    expect(fieldChoices('read', name)).toEqual(['read']);
  });

  it('counts the live fields a subject limits, not rules for fields since archived', () => {
    expect(limitedCount({ [SALARY]: 'hidden', '00000000-0000-7000-8000-0000000000f9': 'read' }, FIELDS)).toBe(1);
    expect(limitedCount({}, FIELDS)).toBe(0);
  });
});
