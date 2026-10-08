// The pure access policy (spec 0009, AC-133, AC-134, AC-148, AC-150), unit
// tested over the whole grid of role, object level, field level and record
// rule, every fail closed default included.
import { PERMISSION_NAMES, ROLE_PERMISSIONS, ROLES, type Role } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  can,
  fieldLevel,
  filterRecordView,
  keyAccess,
  NO_RULES,
  objectLevel,
  OPEN_KEY,
  policyKey,
  readOnlyReason,
  recordRule,
  roleAccess,
  SYSTEM_ACCESS,
  visibleAttributes,
  type AccessRules,
  type FieldLevel,
  type LevelRule,
  type MemberPrincipal,
  type ObjectLevel,
} from './policy.ts';

const OBJECT = '00000000-0000-7000-8000-00000000000a';
const OTHER = '00000000-0000-7000-8000-00000000000b';
const FIELD = '00000000-0000-7000-8000-0000000000f1';
const MEMBER_FIELD = '00000000-0000-7000-8000-0000000000f2';
const TEAM = '00000000-0000-7000-8000-0000000000c1';

const member = (role: string, teamIds: readonly string[] = []): MemberPrincipal => ({
  kind: 'member',
  memberId: '00000000-0000-7000-8000-000000000001',
  role: role as Role,
  teamIds,
});

const rules = (levels: readonly LevelRule[], records: AccessRules['records'] = []): AccessRules => ({
  levels,
  records,
});
const objectRule = (level: string, role = 'member'): LevelRule => ({
  subject: { type: 'role', role },
  target: { type: 'object', objectId: OBJECT },
  level,
});
const fieldRule = (level: string, role = 'member'): LevelRule => ({
  subject: { type: 'role', role },
  target: { type: 'attribute', objectId: OBJECT, attributeId: FIELD },
  level,
});

describe('roles', () => {
  it.each(ROLES)('gives a %s exactly the permissions its catalog row lists, and write on everything', (role) => {
    const access = roleAccess(member(role));
    expect(access.permissions).toEqual(ROLE_PERMISSIONS[role]);
    expect(access.data.key).toBe(OPEN_KEY);
    expect(objectLevel(access, OBJECT)).toBe('write');
    expect(fieldLevel(access, { id: FIELD, objectId: OBJECT })).toBe('write');
    expect(recordRule(access, OBJECT)).toBeUndefined();
  });

  it('never inherits: an admin holds no owner only permission, a member nothing but export', () => {
    expect(can(roleAccess(member('admin')), 'billing.manage')).toBe(false);
    expect(can(roleAccess(member('owner')), 'billing.manage')).toBe(true);
    expect(roleAccess(member('member')).permissions).toEqual(['records.export']);
    expect(can(roleAccess(member('member')), 'schema.manage')).toBe(false);
    expect(can(roleAccess(member('admin')), 'schema.manage')).toBe(true);
  });

  it('fails closed on a role the code does not know: no permission and no data', () => {
    const access = roleAccess(member('guest'));
    expect(access.permissions).toEqual([]);
    expect(objectLevel(access, OBJECT)).toBe('none');
    expect(fieldLevel(access, { id: FIELD, objectId: OBJECT })).toBe('hidden');
    expect(access.data.key).not.toBe(OPEN_KEY);
  });

  it('grants nothing for a permission name outside the catalog', () => {
    const owner = roleAccess(member('owner'));
    expect(can(owner, 'schema.admin')).toBe(false);
    expect(can(owner, '')).toBe(false);
    expect(can(owner, 'constructor')).toBe(false);
  });

  it('freezes what it builds, so nothing can grant itself more later', () => {
    const access = roleAccess(member('member'));
    expect(() => (access.permissions as string[]).push('schema.manage')).toThrow(TypeError);
    expect(() => {
      (access.data.objects as Record<string, string>)[OBJECT] = 'write';
    }).toThrow(TypeError);
    expect(Object.isFrozen(access)).toBe(true);
    expect(Object.isFrozen(access.principal)).toBe(true);
    expect(can(access, 'schema.manage')).toBe(false);
  });
});

describe('the data grid: object level × field level', () => {
  const OBJECT_RULES = ['none', 'read', 'write', undefined, 'bogus'] as const;
  const FIELD_RULES = ['hidden', 'read', 'write', undefined, 'bogus'] as const;
  const objectExpected = (rule: (typeof OBJECT_RULES)[number]): ObjectLevel =>
    rule === undefined ? 'write' : rule === 'bogus' ? 'none' : rule;
  const rank = { hidden: 0, read: 1, write: 2 } as const;
  const asField = { none: 'hidden', read: 'read', write: 'write' } as const;

  for (const objectRuleLevel of OBJECT_RULES) {
    for (const fieldRuleLevel of FIELD_RULES) {
      it(`object ${String(objectRuleLevel)}, field ${String(fieldRuleLevel)}`, () => {
        const levels = [
          ...(objectRuleLevel === undefined ? [] : [objectRule(objectRuleLevel)]),
          ...(fieldRuleLevel === undefined ? [] : [fieldRule(fieldRuleLevel)]),
        ];
        const access = roleAccess(member('member'), rules(levels));
        // An unknown field level denies the whole object, for that subject.
        const object = fieldRuleLevel === 'bogus' ? 'none' : objectExpected(objectRuleLevel);
        const ofObject: FieldLevel = asField[object];
        const own: FieldLevel = fieldRuleLevel === undefined || fieldRuleLevel === 'bogus' ? ofObject : fieldRuleLevel;
        const field = rank[own] <= rank[ofObject] ? own : ofObject;
        expect(objectLevel(access, OBJECT)).toBe(object);
        expect(fieldLevel(access, { id: FIELD, objectId: OBJECT })).toBe(field);
        // Another object and another field are untouched.
        expect(objectLevel(access, OTHER)).toBe('write');
        expect(fieldLevel(access, { id: MEMBER_FIELD, objectId: OTHER })).toBe('write');
        expect(access.data.key).toEqual(levels.length === 0 ? OPEN_KEY : expect.stringMatching(/^[0-9a-f]{16}$/));
      });
    }
  }

  it('applies only rules about the member’s role or teams, and the strictest of several', () => {
    expect(objectLevel(roleAccess(member('admin'), rules([objectRule('none')])), OBJECT)).toBe('write');
    const teamRead: LevelRule = {
      subject: { type: 'team', teamId: TEAM },
      target: { type: 'object', objectId: OBJECT },
      level: 'read',
    };
    expect(objectLevel(roleAccess(member('member'), rules([teamRead])), OBJECT)).toBe('write');
    expect(objectLevel(roleAccess(member('member', [TEAM]), rules([teamRead])), OBJECT)).toBe('read');
    expect(objectLevel(roleAccess(member('member', [TEAM]), rules([objectRule('write'), teamRead])), OBJECT)).toBe(
      'read',
    );
    expect(
      fieldLevel(roleAccess(member('member'), rules([fieldRule('write'), fieldRule('hidden')])), {
        id: FIELD,
        objectId: OBJECT,
      }),
    ).toBe('hidden');
  });

  it('gives none on an object with no entry when the default is none', () => {
    const access = keyAccess('k', []);
    expect(objectLevel(access, OBJECT)).toBe('none');
    expect(fieldLevel(access, { id: FIELD, objectId: OBJECT })).toBe('hidden');
    expect(objectLevel(access, 'constructor')).toBe('none');
  });
});

describe('record rules', () => {
  const recordRuleRow = (kind: string, subject = { type: 'role', role: 'member' } as const) => ({
    subject,
    objectId: OBJECT,
    kind,
    attributeId: MEMBER_FIELD,
  });

  it('narrows an object to own or team records, own winning over team', () => {
    expect(recordRule(roleAccess(member('member'), rules([], [recordRuleRow('own')])), OBJECT)).toEqual({
      kind: 'own',
      attributeId: MEMBER_FIELD,
    });
    expect(recordRule(roleAccess(member('member'), rules([], [recordRuleRow('team')])), OBJECT)?.kind).toBe('team');
    expect(
      recordRule(roleAccess(member('member'), rules([], [recordRuleRow('team'), recordRuleRow('own')])), OBJECT)?.kind,
    ).toBe('own');
    expect(recordRule(roleAccess(member('admin'), rules([], [recordRuleRow('own')])), OBJECT)).toBeUndefined();
    expect(recordRule(roleAccess(member('member'), rules([], [recordRuleRow('own')])), OTHER)).toBeUndefined();
  });

  it('denies the whole object for a rule kind it does not know', () => {
    const access = roleAccess(member('member'), rules([], [recordRuleRow('everyone')]));
    expect(objectLevel(access, OBJECT)).toBe('none');
    expect(recordRule(access, OBJECT)).toBeUndefined();
  });
});

describe('policyKey', () => {
  it('is open with no rules, and a stable 16 hex digest otherwise, whatever the rules’ order', () => {
    expect(roleAccess(member('owner'), NO_RULES).data.key).toBe(OPEN_KEY);
    const a = roleAccess(member('member'), rules([objectRule('read'), fieldRule('hidden')]));
    const b = roleAccess(member('member'), rules([fieldRule('hidden'), objectRule('read')]));
    expect(a.data.key).toMatch(/^[0-9a-f]{16}$/);
    expect(b.data.key).toBe(a.data.key);
    expect(policyKey(a.data)).toBe(a.data.key);
  });

  it('shares one key between roles with equal policies, and splits different ones', () => {
    const owner = roleAccess(member('owner'));
    const memberAccess = roleAccess(member('member'));
    expect(owner.data.key).toBe(memberAccess.data.key);
    const readOnly = roleAccess(member('member'), rules([objectRule('read')]));
    const hidden = roleAccess(member('member'), rules([objectRule('none')]));
    expect(readOnly.data.key).not.toBe(hidden.data.key);
    expect(keyAccess('k', ['data.read']).data.key).not.toBe(OPEN_KEY);
    expect(keyAccess('k', ['data.write']).data.key).toBe(OPEN_KEY);
  });
});

describe('keyAccess (AC-148)', () => {
  it('holds the chosen permissions, never one that stays with people, and nothing for an unknown scope', () => {
    const access = keyAccess('key-1', ['schema.manage', 'members.manage', 'billing.manage', 'support.grant', 'nope']);
    expect(access.permissions).toEqual(['schema.manage']);
    expect(access.principal).toEqual({
      kind: 'api_key',
      keyId: 'key-1',
      scopes: ['schema.manage', 'members.manage', 'billing.manage', 'support.grant', 'nope'],
    });
    for (const forbidden of [
      'members.manage',
      'access.manage',
      'billing.manage',
      'workspace.delete',
      'support.grant',
    ]) {
      expect(can(keyAccess('k', [...PERMISSION_NAMES, 'data.write']), forbidden)).toBe(false);
    }
  });

  it('reads or writes every object by its data scope, and no data without one', () => {
    expect(objectLevel(keyAccess('k', ['data.read']), OBJECT)).toBe('read');
    expect(objectLevel(keyAccess('k', ['data.write']), OBJECT)).toBe('write');
    expect(objectLevel(keyAccess('k', ['data.read', 'data.write']), OBJECT)).toBe('write');
    expect(objectLevel(keyAccess('k', ['records.export']), OBJECT)).toBe('none');
  });
});

describe('the system', () => {
  it('holds every permission and the open policy', () => {
    expect(SYSTEM_ACCESS.permissions).toEqual(PERMISSION_NAMES);
    expect(SYSTEM_ACCESS.data.key).toBe(OPEN_KEY);
    expect(SYSTEM_ACCESS.principal).toEqual({ kind: 'system' });
  });
});

describe('visibleAttributes, filterRecordView and readOnlyReason', () => {
  const attributes = [
    { id: FIELD, objectId: OBJECT, title: 'Salary' },
    { id: MEMBER_FIELD, objectId: OBJECT, title: 'Owner' },
  ];

  it('leaves hidden attributes out, in order', () => {
    expect(visibleAttributes(roleAccess(member('member')), attributes)).toEqual(attributes);
    expect(visibleAttributes(roleAccess(member('member'), rules([fieldRule('hidden')])), attributes)).toEqual([
      attributes[1],
    ]);
    expect(visibleAttributes(roleAccess(member('member'), rules([objectRule('none')])), attributes)).toEqual([]);
  });

  const far = { objectId: OTHER, recordId: '00000000-0000-7000-8000-0000000000e1' };
  const ruled = { objectId: OTHER, recordId: '00000000-0000-7000-8000-0000000000e2' };
  const view = {
    id: 'r1',
    objectId: OBJECT,
    values: { [FIELD]: 'secret', [MEMBER_FIELD]: [far, ruled], ref: far },
    versions: { [FIELD]: 'v1', [MEMBER_FIELD]: 'v2' },
    linkTotals: { [FIELD]: 30 },
  };

  it('keeps the whole record under the open policy', () => {
    expect(filterRecordView(roleAccess(member('member')), view)).toEqual(view);
  });

  it('drops a hidden field’s value, version and link total', () => {
    const cut = filterRecordView(roleAccess(member('member'), rules([fieldRule('hidden')])), view);
    expect(cut.values).toEqual({ [MEMBER_FIELD]: [far, ruled], ref: far });
    expect(cut.versions).toEqual({ [MEMBER_FIELD]: 'v2' });
    expect(cut.linkTotals).toEqual({});
  });

  it('drops far records on a hidden object, and under a record rule those not known to be visible', () => {
    const hiddenFar: LevelRule = {
      subject: { type: 'role', role: 'member' },
      target: { type: 'object', objectId: OTHER },
      level: 'none',
    };
    const none = filterRecordView(roleAccess(member('member'), rules([hiddenFar])), view);
    expect(none.values).toEqual({ [FIELD]: 'secret', [MEMBER_FIELD]: [], ref: null });
    const underRule = roleAccess(
      member('member'),
      rules([], [{ subject: { type: 'role', role: 'member' }, objectId: OTHER, kind: 'own', attributeId: FIELD }]),
    );
    expect(filterRecordView(underRule, view).values[MEMBER_FIELD]).toEqual([]);
    expect(filterRecordView(underRule, view, new Set([far.recordId])).values).toEqual({
      [FIELD]: 'secret',
      [MEMBER_FIELD]: [far],
      ref: far,
    });
  });

  it('gives the object’s reason on a read only object, else the field rule’s, else none', () => {
    const object = { id: OBJECT, pluralName: 'People' };
    expect(
      readOnlyReason(roleAccess(member('member')), { id: FIELD, objectId: OBJECT, title: 'Salary' }, object),
    ).toBeUndefined();
    expect(
      readOnlyReason(
        roleAccess(member('member'), rules([objectRule('read')])),
        { id: FIELD, objectId: OBJECT, title: 'Salary' },
        object,
      ),
    ).toBe('You can view People but not change them.');
    expect(
      readOnlyReason(
        roleAccess(member('member'), rules([fieldRule('read')])),
        { id: FIELD, objectId: OBJECT, title: 'Salary' },
        object,
      ),
    ).toBe("Your role can't change Salary.");
  });
});
