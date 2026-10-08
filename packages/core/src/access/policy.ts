// The access policy (spec 0009): who is acting (a principal), what they may
// do (their permissions) and what they may see and change (their data
// policy), and the pure functions that answer every access question about
// them. Nothing here reads the database; the door builds an `Access` once per
// request (or job run) and seals it into the scope, and the engine's choke
// points ask these functions.
//
// Fail closed throughout: an unknown role, permission, scope, level or rule
// grants nothing, and a field is never more open than its object.
//
// Everything an `Access` holds is frozen: permissions are a frozen list, not a
// Set, and the policy's maps are frozen records, not Maps, since a Set or a
// Map stays writable at run time behind a `Readonly` type.
import { createHash } from 'node:crypto';
import {
  KEY_DATA_SCOPES,
  KEY_FORBIDDEN_PERMISSIONS,
  PERMISSION_NAMES,
  ROLE_PERMISSIONS,
  ROLES,
  type Permission,
  type Role,
} from '@crm/contracts';

/** What a principal may do with an object's records. */
export type ObjectLevel = 'none' | 'read' | 'write';
/** What a principal may do with one attribute's values. */
export type FieldLevel = 'hidden' | 'read' | 'write';

const OBJECT_RANK: Readonly<Record<ObjectLevel, number>> = { none: 0, read: 1, write: 2 };
const FIELD_RANK: Readonly<Record<FieldLevel, number>> = { hidden: 0, read: 1, write: 2 };
const FIELD_OF_OBJECT: Readonly<Record<ObjectLevel, FieldLevel>> = { none: 'hidden', read: 'read', write: 'write' };

const isObjectLevel = (value: unknown): value is ObjectLevel =>
  typeof value === 'string' && Object.hasOwn(OBJECT_RANK, value);
const isFieldLevel = (value: unknown): value is FieldLevel =>
  typeof value === 'string' && Object.hasOwn(FIELD_RANK, value);

/** True when `value` is one of the roles the code knows. */
export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** True when `value` is a permission in the catalog. */
export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSION_NAMES as readonly string[]).includes(value);
}

/** A record rule: only records whose member attribute names the principal (`own`) or their teams (`team`). */
export interface RecordRule {
  readonly kind: 'own' | 'team';
  /** The member attribute (an `actor_reference`) the rule reads. */
  readonly attributeId: string;
}

/**
 * What a principal may see and change. An object with no entry gets
 * `defaultObject`; an attribute with no entry gets its object's level; an
 * object with no record rule shows every record. `key` names the policy for
 * audiences: `open` when nothing is restricted.
 */
export interface DataPolicy {
  readonly defaultObject: ObjectLevel;
  /** Object (or list) id to its level. */
  readonly objects: Readonly<Record<string, ObjectLevel>>;
  /** Attribute id to its level, never above its object's. */
  readonly fields: Readonly<Record<string, FieldLevel>>;
  /** Object id to the record rule that narrows which of its records are visible. */
  readonly records: Readonly<Record<string, RecordRule>>;
  readonly key: string;
}

/** Who is acting: a member (with their role and teams), an API key (with its scopes), or the system. */
export type Principal =
  | {
      readonly kind: 'member';
      readonly memberId: string;
      /** The signed in identity (`auth.user.id`); a member made without one has none. */
      readonly userId?: string;
      readonly role: Role;
      /** The member's teams, empty until #23. */
      readonly teamIds: readonly string[];
    }
  | { readonly kind: 'api_key'; readonly keyId: string; readonly scopes: readonly string[] }
  | { readonly kind: 'system' };

/** A member principal. */
export type MemberPrincipal = Extract<Principal, { kind: 'member' }>;

/** What a principal may do: its permissions and its data policy. Built only by the functions here. */
export interface Access {
  readonly principal: Principal;
  readonly permissions: readonly Permission[];
  readonly data: DataPolicy;
}

/** Who a rule is about: everyone with a role, or everyone in a team (#23). */
export type RuleSubject =
  { readonly type: 'role'; readonly role: string } | { readonly type: 'team'; readonly teamId: string };

/**
 * One object or field rule, as #24's `access_rules` stores it. `level` is kept
 * as stored text: a level the code doesn't know denies the whole object for
 * its subject.
 */
export interface LevelRule {
  readonly subject: RuleSubject;
  readonly target:
    | { readonly type: 'object'; readonly objectId: string }
    | { readonly type: 'attribute'; readonly objectId: string; readonly attributeId: string };
  readonly level: string;
}

/** One record rule, as #24's `record_rules` stores it. A kind the code doesn't know denies the object. */
export interface RecordRuleRow {
  readonly subject: RuleSubject;
  readonly objectId: string;
  readonly kind: string;
  readonly attributeId: string;
}

/** The workspace's rules: empty until #24 stores them (tests inject them through the door). */
export interface AccessRules {
  readonly levels: readonly LevelRule[];
  readonly records: readonly RecordRuleRow[];
}

/** No rules at all: every role writes every object and field, with no record rule. */
export const NO_RULES: AccessRules = Object.freeze({ levels: Object.freeze([]), records: Object.freeze([]) });

/** The `key` of a policy that restricts nothing. */
export const OPEN_KEY = 'open';

function frozenRecord<V>(entries: Iterable<readonly [string, V]>): Readonly<Record<string, V>> {
  const record: Record<string, V> = Object.create(null) as Record<string, V>;
  for (const [key, value] of entries) record[key] = value;
  return Object.freeze(record);
}

/** A policy with its `key` computed, frozen. */
function sealPolicy(policy: Omit<DataPolicy, 'key'>): DataPolicy {
  return Object.freeze({ ...policy, key: policyKey(policy) });
}

/** The policy that restricts nothing: write on every object and field, no record rule. */
const OPEN_POLICY: DataPolicy = sealPolicy({
  defaultObject: 'write',
  objects: frozenRecord([]),
  fields: frozenRecord([]),
  records: frozenRecord([]),
});

/** A policy with no data at all, for a principal the code doesn't recognise. */
const CLOSED_POLICY: DataPolicy = sealPolicy({
  defaultObject: 'none',
  objects: frozenRecord([]),
  fields: frozenRecord([]),
  records: frozenRecord([]),
});

/**
 * The audience key of a data policy (spec 0009, Live events): `open` when it
 * restricts nothing, else the first 16 hex characters of the SHA-256 of its
 * canonical JSON (keys sorted), so members with equal policies share it.
 */
export function policyKey(policy: Omit<DataPolicy, 'key'>): string {
  const restricted =
    policy.defaultObject !== 'write' ||
    Object.keys(policy.objects).length > 0 ||
    Object.keys(policy.fields).length > 0 ||
    Object.keys(policy.records).length > 0;
  if (!restricted) return OPEN_KEY;
  const sorted = <V>(record: Readonly<Record<string, V>>) =>
    Object.keys(record)
      .sort()
      .map((key) => [key, record[key]]);
  const canonical = JSON.stringify({
    defaultObject: policy.defaultObject,
    objects: sorted(policy.objects),
    fields: sorted(policy.fields),
    records: Object.keys(policy.records)
      .sort()
      .map((key) => {
        const rule = policy.records[key];
        return [key, rule === undefined ? null : [rule.kind, rule.attributeId]];
      }),
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

function subjectMatches(subject: RuleSubject, principal: MemberPrincipal): boolean {
  if (subject.type === 'role') return subject.role === principal.role;
  return principal.teamIds.includes(subject.teamId);
}

const stricterObject = (a: ObjectLevel, b: ObjectLevel): ObjectLevel => (OBJECT_RANK[a] <= OBJECT_RANK[b] ? a : b);
const stricterField = (a: FieldLevel, b: FieldLevel): FieldLevel => (FIELD_RANK[a] <= FIELD_RANK[b] ? a : b);

/**
 * The data policy the rules give a member. Every rule whose subject is the
 * member's role or one of their teams applies; where several apply to the
 * same object or field, the strictest wins (fail closed). A rule whose level
 * or kind the code doesn't know sets its object to `none`.
 */
function memberPolicy(principal: MemberPrincipal, rules: AccessRules): DataPolicy {
  const objects = new Map<string, ObjectLevel>();
  const fields = new Map<string, FieldLevel>();
  const records = new Map<string, RecordRule>();
  const deny = (objectId: string) => objects.set(objectId, 'none');
  const setObject = (objectId: string, level: ObjectLevel) =>
    objects.set(objectId, stricterObject(objects.get(objectId) ?? level, level));
  for (const rule of rules.levels) {
    if (!subjectMatches(rule.subject, principal)) continue;
    const { target } = rule;
    if (target.type === 'object') {
      if (isObjectLevel(rule.level)) setObject(target.objectId, rule.level);
      else deny(target.objectId);
    } else if (isFieldLevel(rule.level)) {
      fields.set(target.attributeId, stricterField(fields.get(target.attributeId) ?? rule.level, rule.level));
    } else {
      deny(target.objectId);
    }
  }
  for (const rule of rules.records) {
    if (!subjectMatches(rule.subject, principal)) continue;
    if (rule.kind !== 'own' && rule.kind !== 'team') {
      deny(rule.objectId);
      continue;
    }
    const earlier = records.get(rule.objectId);
    // `own` is narrower than `team`: of two rules, own wins.
    if (earlier === undefined || rule.kind === 'own') {
      records.set(rule.objectId, Object.freeze({ kind: rule.kind, attributeId: rule.attributeId }));
    }
  }
  return sealPolicy({
    defaultObject: 'write',
    objects: frozenRecord(objects),
    fields: frozenRecord(fields),
    records: frozenRecord(records),
  });
}

/**
 * A member's access: the permissions their role lists in the catalog, and the
 * data policy the rules give them (`NO_RULES` until #24: write everywhere).
 * A role the code doesn't know grants nothing and sees nothing.
 */
export function roleAccess(principal: MemberPrincipal, rules: AccessRules = NO_RULES): Access {
  if (!isRole(principal.role)) {
    return Object.freeze({
      principal: Object.freeze({ ...principal }),
      permissions: Object.freeze([]),
      data: CLOSED_POLICY,
    });
  }
  return Object.freeze({
    principal: Object.freeze({ ...principal, teamIds: Object.freeze([...principal.teamIds]) }),
    permissions: Object.freeze([...ROLE_PERMISSIONS[principal.role]]),
    data: memberPolicy(principal, rules),
  });
}

/**
 * An API key's access (spec 0009, AC-148; #34 stores keys): the permissions
 * among its scopes, never one of the seven that stay with people, and a data
 * level on every object, `write` with `data.write`, `read` with `data.read`,
 * else none. A scope the catalog doesn't list grants nothing.
 */
export function keyAccess(keyId: string, scopes: readonly string[]): Access {
  const permissions = PERMISSION_NAMES.filter(
    (permission) => scopes.includes(permission) && !KEY_FORBIDDEN_PERMISSIONS.includes(permission),
  );
  const [read, write] = KEY_DATA_SCOPES;
  const level: ObjectLevel = scopes.includes(write) ? 'write' : scopes.includes(read) ? 'read' : 'none';
  return Object.freeze({
    principal: Object.freeze({ kind: 'api_key', keyId, scopes: Object.freeze([...scopes]) }),
    permissions: Object.freeze(permissions),
    data: sealPolicy({
      defaultObject: level,
      objects: frozenRecord([]),
      fields: frozenRecord([]),
      records: frozenRecord([]),
    }),
  });
}

/** The system's access: every permission and the open policy. Only system work gets it. */
export const SYSTEM_ACCESS: Access = Object.freeze({
  principal: Object.freeze({ kind: 'system' }),
  permissions: Object.freeze([...PERMISSION_NAMES]),
  data: OPEN_POLICY,
});

/** Whether the access holds a permission. A name outside the catalog is never held. */
export function can(access: Access, permission: string): boolean {
  return isPermission(permission) && access.permissions.includes(permission);
}

/** The principal's level on an object (or list): its entry, else the default; anything unknown is `none`. */
export function objectLevel(access: Pick<Access, 'data'>, objectId: string): ObjectLevel {
  const { data } = access;
  const level: unknown = Object.hasOwn(data.objects, objectId) ? data.objects[objectId] : data.defaultObject;
  return isObjectLevel(level) ? level : 'none';
}

/** An attribute, as the policy needs it: its id and its object. */
export interface PolicyAttribute {
  readonly id: string;
  readonly objectId: string;
}

/** The principal's level on an attribute: the stricter of its own rule and its object's level. */
export function fieldLevel(access: Pick<Access, 'data'>, attribute: PolicyAttribute): FieldLevel {
  const ofObject = FIELD_OF_OBJECT[objectLevel(access, attribute.objectId)];
  if (!Object.hasOwn(access.data.fields, attribute.id)) return ofObject;
  const own: unknown = access.data.fields[attribute.id];
  return isFieldLevel(own) ? stricterField(own, ofObject) : 'hidden';
}

/** The record rule on an object, if any narrows which of its records the principal sees. */
export function recordRule(access: Pick<Access, 'data'>, objectId: string): RecordRule | undefined {
  return Object.hasOwn(access.data.records, objectId) ? access.data.records[objectId] : undefined;
}

/** The attributes the principal may see (read or write), in their order. */
export function visibleAttributes<T extends PolicyAttribute>(
  access: Pick<Access, 'data'>,
  attributes: readonly T[],
): T[] {
  return attributes.filter((attribute) => fieldLevel(access, attribute) !== 'hidden');
}

/** A record as `readRecords` answers it, as far as the policy reads it. */
export interface PolicyRecordView {
  readonly id: string;
  readonly objectId: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly versions: Readonly<Record<string, string>>;
  readonly linkTotals: Readonly<Record<string, number>>;
}

interface ReferenceShape {
  readonly objectId: string;
  readonly recordId: string;
}

const isReference = (value: unknown): value is ReferenceShape =>
  typeof value === 'object' &&
  value !== null &&
  'objectId' in value &&
  'recordId' in value &&
  typeof value.objectId === 'string' &&
  typeof value.recordId === 'string';

/**
 * A record view cut to what the principal may see: hidden attributes' values,
 * versions and link totals left out, and from every reference value the far
 * records the principal can't see. A far record is visible when its object
 * isn't at `none` and, under a record rule, it is in `visibleFar` (the ids
 * the caller found inside the rule); with no such list, a far record under a
 * rule is left out (fail closed). The record itself must already be visible.
 */
export function filterRecordView<T extends PolicyRecordView>(
  access: Access,
  view: T,
  visibleFar: ReadonlySet<string> = new Set(),
): T {
  const farVisible = (reference: ReferenceShape) =>
    objectLevel(access, reference.objectId) !== 'none' &&
    (recordRule(access, reference.objectId) === undefined || visibleFar.has(reference.recordId));
  const shown = (attributeId: string) => fieldLevel(access, { id: attributeId, objectId: view.objectId }) !== 'hidden';
  const values = Object.entries(view.values).flatMap(([attributeId, value]): [string, unknown][] => {
    if (!shown(attributeId)) return [];
    if (isReference(value)) return [[attributeId, farVisible(value) ? value : null]];
    if (Array.isArray(value) && value.some(isReference)) {
      return [[attributeId, value.filter((item) => !isReference(item) || farVisible(item))]];
    }
    return [[attributeId, value]];
  });
  const keep = <V>(record: Readonly<Record<string, V>>) =>
    Object.fromEntries(Object.entries(record).filter(([attributeId]) => shown(attributeId)));
  return {
    ...view,
    values: Object.fromEntries(values),
    versions: keep(view.versions),
    linkTotals: keep(view.linkTotals),
  };
}

/**
 * Why the principal can't change an attribute, or undefined when they can:
 * the object's reason when they may only read the object, else the field
 * rule's. Today's system and archived reasons stay with the caller.
 */
export function readOnlyReason(
  access: Access,
  attribute: PolicyAttribute & { readonly title: string },
  object: { readonly id: string; readonly pluralName: string },
): string | undefined {
  if (objectLevel(access, object.id) === 'read') {
    return `You can view ${object.pluralName} but not change them.`;
  }
  if (fieldLevel(access, attribute) === 'read') return `Your role can't change ${attribute.title}.`;
  return undefined;
}
