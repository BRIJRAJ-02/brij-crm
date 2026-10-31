// The pure access policy (spec 0009, AC-133, AC-134, AC-148, AC-150), unit
// tested over the whole grid of role, object level, field level and record
// rule, every fail closed default included.
import { PERMISSION_NAMES, ROLE_PERMISSIONS, ROLES, type Role } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { exportAccessKey } from '../forms/export.ts';
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
  ruleMembers,
  SYSTEM_ACCESS,
  visibleAttributes,
  type AccessRules,
  type FieldLevel,
  type LevelRule,
  type MemberPrincipal,
  type ObjectLevel,
  type RuleSubject,
} from './policy.ts';

const OBJECT = '00000000-0000-7000-8000-00000000000a';
const OTHER = '00000000-0000-7000-8000-00000000000b';
const FIELD = '00000000-0000-7000-8000-0000000000f1';
const MEMBER_FIELD = '00000000-0000-7000-8000-0000000000f2';
const TEAM = '00000000-0000-7000-8000-0000000000c1';
const OTHER_TEAM = '00000000-0000-7000-8000-0000000000c2';

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
  // A guest sees nothing by default: its own block below.
  it.each(ROLES.filter((role) => role !== 'guest'))(
    'gives a %s exactly the permissions its catalog row lists, and write on everything',
    (role) => {
      const access = roleAccess(member(role));
      expect(access.permissions).toEqual(ROLE_PERMISSIONS[role]);
      expect(access.data.key).toBe(OPEN_KEY);
      expect(objectLevel(access, OBJECT)).toBe('write');
      expect(fieldLevel(access, { id: FIELD, objectId: OBJECT })).toBe('write');
      expect(recordRule(access, OBJECT)).toBeUndefined();
    },
  );

  it('never inherits: an admin holds no owner only permission, a member nothing but export and their booking pages', () => {
    expect(can(roleAccess(member('admin')), 'billing.manage')).toBe(false);
    expect(can(roleAccess(member('owner')), 'billing.manage')).toBe(true);
    expect(roleAccess(member('member')).permissions).toEqual([
      'lists.manage',
      'records.export',
      'booking.manage',
      'availability.own',
    ]);
    expect(can(roleAccess(member('member')), 'schema.manage')).toBe(false);
    expect(can(roleAccess(member('admin')), 'schema.manage')).toBe(true);
  });

  it('fails closed on a role the code does not know: no permission and no data', () => {
    const access = roleAccess(member('viewer'));
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
        // A result that restricts nothing is the open policy, whatever rules named it (they cancel into it).
        expect(access.data.key).toEqual(
          object === 'write' && field === 'write' ? OPEN_KEY : expect.stringMatching(/^[0-9a-f]{16}$/),
        );
      });
    }
  }

  it('applies only rules about the member’s role or teams, and the most open of several (AC-844)', () => {
    expect(objectLevel(roleAccess(member('admin'), rules([objectRule('none')])), OBJECT)).toBe('write');
    const teamRead: LevelRule = {
      subject: { type: 'team', teamId: TEAM },
      target: { type: 'object', objectId: OBJECT },
      level: 'read',
    };
    // A team rule only grants: it never takes away what the role leaves, and it is no one else's.
    expect(objectLevel(roleAccess(member('member'), rules([teamRead])), OBJECT)).toBe('write');
    expect(objectLevel(roleAccess(member('member', [TEAM]), rules([teamRead])), OBJECT)).toBe('write');
    // The role restricts and the team grants back: the more open wins, whichever way round they are listed.
    for (const levels of [
      [objectRule('none'), teamRead],
      [teamRead, objectRule('none')],
    ]) {
      expect(objectLevel(roleAccess(member('member', [TEAM]), rules(levels)), OBJECT)).toBe('read');
      expect(objectLevel(roleAccess(member('member'), rules(levels)), OBJECT)).toBe('none');
    }
    expect(objectLevel(roleAccess(member('member', [TEAM]), rules([objectRule('read'), teamRead])), OBJECT)).toBe(
      'read',
    );
    expect(
      fieldLevel(roleAccess(member('member'), rules([fieldRule('hidden')])), { id: FIELD, objectId: OBJECT }),
    ).toBe('hidden');
  });

  it('grants a restricted object back to a team: members outside it see nothing, owners and admins everything', () => {
    const salesWrite: LevelRule = {
      subject: { type: 'team', teamId: TEAM },
      target: { type: 'object', objectId: OBJECT },
      level: 'write',
    };
    const stored = rules([objectRule('none'), salesWrite]);
    expect(objectLevel(roleAccess(member('member', [TEAM]), stored), OBJECT)).toBe('write');
    expect(objectLevel(roleAccess(member('member', [OTHER_TEAM]), stored), OBJECT)).toBe('none');
    expect(objectLevel(roleAccess(member('member'), stored), OBJECT)).toBe('none');
    // Owners and admins keep the open policy, in a team or not: a team only grants, and no stored rule names them.
    for (const role of ['owner', 'admin']) {
      for (const teams of [[], [TEAM]]) {
        const access = roleAccess(member(role, teams), stored);
        expect(access.data.key).toBe(OPEN_KEY);
        expect(objectLevel(access, OBJECT)).toBe('write');
      }
    }
  });

  it('puts a member whose teams cancel a rule on the open policy, so they share its audience', () => {
    const grant: LevelRule = {
      subject: { type: 'team', teamId: TEAM },
      target: { type: 'object', objectId: OBJECT },
      level: 'write',
    };
    expect(roleAccess(member('member', [TEAM]), rules([objectRule('read'), grant])).data.key).toBe(OPEN_KEY);
    expect(roleAccess(member('member'), rules([objectRule('read'), grant])).data.key).not.toBe(OPEN_KEY);
  });

  it('gives a field its most open level across the views that see the object, never above a view’s object level', () => {
    const teamField = (level: string): LevelRule => ({
      subject: { type: 'team', teamId: TEAM },
      target: { type: 'attribute', objectId: OBJECT, attributeId: FIELD },
      level,
    });
    const teamObject = (level: string): LevelRule => ({
      subject: { type: 'team', teamId: TEAM },
      target: { type: 'object', objectId: OBJECT },
      level,
    });
    const field = { id: FIELD, objectId: OBJECT };
    // Hidden from the role, shown by the team that can edit the object: the team's view shows it.
    expect(
      fieldLevel(roleAccess(member('member', [TEAM]), rules([fieldRule('hidden'), teamObject('write')])), field),
    ).toBe('write');
    // A team view that can only view caps its field at read.
    expect(
      fieldLevel(
        roleAccess(member('member', [TEAM]), rules([objectRule('none'), teamObject('read'), teamField('write')])),
        field,
      ),
    ).toBe('read');
    // A team with no access to the object gives its field rule nothing to show.
    expect(
      fieldLevel(roleAccess(member('member', [TEAM]), rules([objectRule('none'), teamField('write')])), field),
    ).toBe('hidden');
  });

  it('fails closed on a view with a level it does not know, leaving the other views as they are (AC-845)', () => {
    const teamObject = (level: string): LevelRule => ({
      subject: { type: 'team', teamId: TEAM },
      target: { type: 'object', objectId: OBJECT },
      level,
    });
    // The team's stored level is unknown: it grants nothing, and the role's own rule stands.
    expect(
      objectLevel(roleAccess(member('member', [TEAM]), rules([objectRule('read'), teamObject('manage')])), OBJECT),
    ).toBe('read');
    // The role's is unknown: that view sees nothing, so the team's grant is all there is.
    expect(
      objectLevel(roleAccess(member('member', [TEAM]), rules([objectRule('manage'), teamObject('read')])), OBJECT),
    ).toBe('read');
    expect(objectLevel(roleAccess(member('member'), rules([objectRule('manage')])), OBJECT)).toBe('none');
  });

  it('gives none on an object with no entry when the default is none', () => {
    const access = keyAccess('k', []);
    expect(objectLevel(access, OBJECT)).toBe('none');
    expect(fieldLevel(access, { id: FIELD, objectId: OBJECT })).toBe('hidden');
    expect(objectLevel(access, 'constructor')).toBe('none');
  });
});

describe('a guest (spec 0031, AC-828)', () => {
  const teamWrite: LevelRule = {
    subject: { type: 'team', teamId: TEAM },
    target: { type: 'object', objectId: OBJECT },
    level: 'write',
  };

  it('holds no permission and sees nothing until a rule shares an object', () => {
    const access = roleAccess(member('guest'));
    expect(access.permissions).toEqual([]);
    expect(access.data.defaultObject).toBe('none');
    expect(objectLevel(access, OBJECT)).toBe('none');
    expect(access.data.key).not.toBe(OPEN_KEY);
    // A rule for Members never reaches a guest.
    expect(objectLevel(roleAccess(member('guest'), rules([objectRule('write')])), OBJECT)).toBe('none');
  });

  it('views what the Guest role is shared, and nothing else', () => {
    const access = roleAccess(member('guest'), rules([objectRule('read', 'guest')]));
    expect(objectLevel(access, OBJECT)).toBe('read');
    expect(objectLevel(access, OTHER)).toBe('none');
    expect(fieldLevel(access, { id: FIELD, objectId: OBJECT })).toBe('read');
  });

  it('never edits: a stored edit for the Guest role, or a team that edits, gives them view at most', () => {
    expect(objectLevel(roleAccess(member('guest'), rules([objectRule('write', 'guest')])), OBJECT)).toBe('read');
    expect(objectLevel(roleAccess(member('guest', [TEAM]), rules([teamWrite])), OBJECT)).toBe('read');
    // The same team still lets a member in it edit.
    expect(objectLevel(roleAccess(member('member', [TEAM]), rules([objectRule('none'), teamWrite])), OBJECT)).toBe(
      'write',
    );
  });
});

describe('record rules', () => {
  const recordRuleRow = (kind: string, subject: RuleSubject = { type: 'role', role: 'member' }) => ({
    subject,
    objectId: OBJECT,
    kind,
    attributeId: MEMBER_FIELD,
  });

  it('narrows an object to own or team records, the broadest scope across the views winning (AC-844)', () => {
    expect(recordRule(roleAccess(member('member'), rules([], [recordRuleRow('own')])), OBJECT)).toEqual({
      kind: 'own',
      attributeId: MEMBER_FIELD,
    });
    expect(recordRule(roleAccess(member('member'), rules([], [recordRuleRow('team')])), OBJECT)?.kind).toBe('team');
    const team = { type: 'team', teamId: TEAM } as const;
    // Own for the role, their team's for a team they are in (and grant the object): the team's is broader.
    const teamWrite: LevelRule = { subject: team, target: { type: 'object', objectId: OBJECT }, level: 'write' };
    expect(
      recordRule(
        roleAccess(member('member', [TEAM]), rules([teamWrite], [recordRuleRow('own'), recordRuleRow('team', team)])),
        OBJECT,
      )?.kind,
    ).toBe('team');
    // Not in the team, the role's own scope is all there is.
    expect(
      recordRule(
        roleAccess(member('member'), rules([teamWrite], [recordRuleRow('own'), recordRuleRow('team', team)])),
        OBJECT,
      )?.kind,
    ).toBe('own');
    // A team's record rule alone grants nothing: only an object level makes a team a view of the object.
    expect(
      recordRule(
        roleAccess(member('member', [TEAM]), rules([], [recordRuleRow('own'), recordRuleRow('team', team)])),
        OBJECT,
      )?.kind,
    ).toBe('own');
    // A team that grants the object with no record rule sees every record, which makes the object whole.
    const grant: LevelRule = { subject: team, target: { type: 'object', objectId: OBJECT }, level: 'write' };
    expect(
      recordRule(roleAccess(member('member', [TEAM]), rules([grant], [recordRuleRow('own')])), OBJECT),
    ).toBeUndefined();
    expect(recordRule(roleAccess(member('admin'), rules([], [recordRuleRow('own')])), OBJECT)).toBeUndefined();
    expect(recordRule(roleAccess(member('member'), rules([], [recordRuleRow('own')])), OTHER)).toBeUndefined();
  });

  it('never gives the level of one view on the records of another (no escalation across rules)', () => {
    const team = { type: 'team', teamId: TEAM } as const;
    const teamRead: LevelRule = { subject: team, target: { type: 'object', objectId: OBJECT }, level: 'read' };
    // Members edit their own records; Sales views all of them. A Sales member views all: not edits all.
    const access = roleAccess(member('member', [TEAM]), rules([teamRead], [recordRuleRow('own')]));
    expect(objectLevel(access, OBJECT)).toBe('read');
    expect(recordRule(access, OBJECT)).toBeUndefined();
    // Outside Sales the same rules leave edit on their own records.
    const outside = roleAccess(member('member'), rules([teamRead], [recordRuleRow('own')]));
    expect(objectLevel(outside, OBJECT)).toBe('write');
    expect(recordRule(outside, OBJECT)?.kind).toBe('own');
    // And a team that edits all while members view their own is edit on all, which is exactly what it grants.
    const teamWrite: LevelRule = { subject: team, target: { type: 'object', objectId: OBJECT }, level: 'write' };
    const grants = roleAccess(member('member', [TEAM]), rules([objectRule('read'), teamWrite], [recordRuleRow('own')]));
    expect(objectLevel(grants, OBJECT)).toBe('write');
    expect(recordRule(grants, OBJECT)).toBeUndefined();
  });

  it('matches the members of the member’s teams, themself included, for a team scope', () => {
    const rule = { kind: 'team', attributeId: MEMBER_FIELD } as const;
    const principal: MemberPrincipal = { ...member('member', [TEAM]), teamMemberIds: ['m2', 'm3'] };
    expect(new Set(ruleMembers({ principal }, rule))).toEqual(new Set([principal.memberId, 'm2', 'm3']));
    // Own is the member alone, and a team scope of someone in no team is their own.
    expect(ruleMembers({ principal }, { kind: 'own', attributeId: MEMBER_FIELD })).toEqual([principal.memberId]);
    expect(ruleMembers({ principal: member('member') }, rule)).toEqual([principal.memberId]);
    expect(ruleMembers({ principal: { kind: 'system' } }, rule)).toEqual([]);
  });

  it('denies the whole object for a rule kind it does not know', () => {
    const access = roleAccess(member('member'), rules([], [recordRuleRow('everyone')]));
    expect(objectLevel(access, OBJECT)).toBe('none');
    expect(recordRule(access, OBJECT)).toBeUndefined();
  });
});

describe('an export’s access key (AC-847)', () => {
  it('holds who a team scope reaches, so a file outlives neither a teammate who left nor a rule that no longer reaches them', () => {
    const principal = (mates: readonly string[]): MemberPrincipal => ({
      ...member('member', [TEAM]),
      teamMemberIds: mates,
    });
    const keyOf = (mates: readonly string[], kind: string) =>
      exportAccessKey(
        roleAccess(
          principal(mates),
          rules([], [{ subject: { type: 'role', role: 'member' }, objectId: OBJECT, kind, attributeId: MEMBER_FIELD }]),
        ),
      );
    // A team scope: a teammate leaving changes the key; their order doesn't.
    expect(keyOf(['m1', 'm2'], 'team')).not.toBe(keyOf(['m1'], 'team'));
    expect(keyOf(['m2', 'm1'], 'team')).toBe(keyOf(['m1', 'm2'], 'team'));
    // An own scope reaches no teammate, so who they are is not in the key.
    expect(keyOf(['m1', 'm2'], 'own')).toBe(keyOf(['m1'], 'own'));
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
      'audit.read',
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

describe('a custom role (spec 0037, AC-1229, AC-1234, AC-1248)', () => {
  const ROLE = '00000000-0000-7000-8000-0000000000e1';
  const holder = (teamIds: readonly string[] = []): MemberPrincipal => ({
    ...member('member', teamIds),
    customRoleId: ROLE,
  });
  const grant = (permissions: readonly string[], defaultObjectLevel = 'write') => ({ permissions, defaultObjectLevel });

  it('holds only the grant any permissions it stores: an admin or owner one, or an unknown name, is nothing', () => {
    const access = roleAccess(
      holder(),
      NO_RULES,
      grant(['schedule.manage', 'members.invite', 'jobs.manage', 'billing.manage', 'routing.manage', 'made.up']),
    );
    expect([...access.permissions]).toEqual(['schedule.manage']);
    expect(can(access, 'members.invite')).toBe(false);
  });

  it('reads its data access as the default object level, any value but write as read (fail closed)', () => {
    expect(roleAccess(holder(), NO_RULES, grant([], 'write')).data.defaultObject).toBe('write');
    expect(roleAccess(holder(), NO_RULES, grant([], 'read')).data.defaultObject).toBe('read');
    expect(roleAccess(holder(), NO_RULES, grant([], 'everything')).data.defaultObject).toBe('read');
    const readOnly = roleAccess(holder(), NO_RULES, grant([], 'read'));
    expect(
      readOnlyReason(readOnly, { id: FIELD, objectId: OBJECT, title: 'Name' }, { id: OBJECT, pluralName: 'People' }),
    ).toBe('Your role can view records but not change them.');
  });

  it('refuses a principal naming a custom role with none read beside it, or on a base role other than Member', () => {
    const missing = roleAccess(holder(), NO_RULES);
    expect(missing.permissions).toEqual([]);
    expect(objectLevel(missing, OBJECT)).toBe('none');
    const onAdmin = roleAccess({ ...member('admin'), customRoleId: ROLE }, NO_RULES, grant(['schedule.view']));
    expect(onAdmin.permissions).toEqual([]);
  });

  it('is under Member’s rules until custom roles get their own (J10), and a team’s grant still opens what it grants', () => {
    const teamRule: LevelRule = {
      subject: { type: 'team', teamId: TEAM },
      target: { type: 'object', objectId: OTHER },
      level: 'write',
    };
    const both = rules([objectRule('none'), teamRule]);
    // A Member is under Member's rule, and so is a holder of a custom role (it sits on Member).
    expect(objectLevel(roleAccess(member('member'), both), OBJECT)).toBe('none');
    expect(objectLevel(roleAccess(holder(), both, grant([])), OBJECT)).toBe('none');
    // A Read only holder in a team that grants write on OTHER gets write there, read elsewhere.
    const readOnlyInTeam = roleAccess(holder([TEAM]), both, grant([], 'read'));
    expect(objectLevel(readOnlyInTeam, OTHER)).toBe('write');
    expect(objectLevel(readOnlyInTeam, OBJECT)).toBe('none');
    expect(objectLevel(readOnlyInTeam, FIELD)).toBe('read');
  });
});
