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
  ROLE_DEFAULT_LEVEL,
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
      /** The member's teams (spec 0031, AC-825), empty for a member in none. */
      readonly teamIds: readonly string[];
      /**
       * The active members of those teams, the member included: who a `team` record rule matches (spec 0032,
       * AC-847). Absent or empty, a team rule matches the member alone.
       */
      readonly teamMemberIds?: readonly string[];
    }
  | { readonly kind: 'api_key'; readonly keyId: string; readonly scopes: readonly string[] }
  /** A form writing its submissions' records (spec 0023): only what its published mapping names. */
  | { readonly kind: 'form'; readonly formId: string }
  /** A visitor booking through a page (spec 0025): the page acts, on People and Companies only. */
  | { readonly kind: 'booking'; readonly pageId: string }
  /**
   * A member reached through an email's preferences link (the emails lane):
   * not a member principal, so no member service takes it; only their own
   * email preferences do.
   */
  | { readonly kind: 'email_link'; readonly memberId: string }
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

/**
 * The rules that apply to a member, as the door's `RuleSource` read them (spec 0032, AC-841), and the teams it read
 * them for: the member's team ids and the active members of those teams (spec 0031, AC-825). Both are empty for
 * rules a test injects by hand, which name teams in their subjects and put the member in them through the principal.
 */
export interface AccessRules {
  readonly levels: readonly LevelRule[];
  readonly records: readonly RecordRuleRow[];
  /** The member's own teams, when the source read them. */
  readonly teamIds?: readonly string[];
  /** The active members of those teams, when the source read them. */
  readonly teamMemberIds?: readonly string[];
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

const higherObject = (a: ObjectLevel, b: ObjectLevel): ObjectLevel => (OBJECT_RANK[a] >= OBJECT_RANK[b] ? a : b);
const stricterField = (a: FieldLevel, b: FieldLevel): FieldLevel => (FIELD_RANK[a] <= FIELD_RANK[b] ? a : b);
const higherField = (a: FieldLevel, b: FieldLevel): FieldLevel => (FIELD_RANK[a] >= FIELD_RANK[b] ? a : b);

/** What a record scope lets through, broadest first: a team's records show more than one's own. */
const SCOPE_RANK: Readonly<Record<RecordRule['kind'], number>> = { team: 1, own: 0 };

/**
 * What a role without a rule may do with an object (spec 0032, AC-844): owners and admins edit, as do members; a rule
 * role the list gives a default (`ROLE_DEFAULT_LEVEL`) gets that; any other role gets nothing (fail closed). A team
 * has no default: it only grants.
 */
const roleDefault = (role: string): ObjectLevel => {
  if (role === 'owner' || role === 'admin') return 'write';
  return Object.hasOwn(ROLE_DEFAULT_LEVEL, role)
    ? ((ROLE_DEFAULT_LEVEL as Readonly<Record<string, ObjectLevel>>)[role] ?? 'none')
    : 'none';
};

/**
 * The most a role may ever do with an object, whatever its rules or its teams grant: a guest reads at most, never
 * edits (spec 0031, AC-828), so a team rule giving a guest's team edit gives the guest view. Other roles are uncapped.
 */
const capped = (role: string, level: ObjectLevel): ObjectLevel =>
  role === 'guest' && level === 'write' ? 'read' : level;

/** What one subject's stored rules say about one object, before they are read as levels. */
interface StoredView {
  level: string | undefined;
  readonly fields: Map<string, string>;
  record: { readonly kind: string; readonly attributeId: string } | undefined;
}

/** One subject's view of one object once read (spec 0032, AC-844, AC-845): a stored value the code doesn't know is `none`. */
interface SubjectView {
  readonly level: ObjectLevel;
  readonly fields: ReadonlyMap<string, FieldLevel>;
  /** The record rule it holds, if it narrows; undefined sees every record. */
  readonly record: RecordRule | undefined;
}

/** Reads a subject's stored rules about an object as a view; `fallback` is the level it has with no object rule. */
function readView(stored: StoredView | undefined, fallback: ObjectLevel): SubjectView {
  const fields = new Map<string, FieldLevel>();
  let unknown = false;
  if (stored?.level !== undefined && !isObjectLevel(stored.level)) unknown = true;
  for (const [attributeId, level] of stored?.fields ?? []) {
    if (isFieldLevel(level)) fields.set(attributeId, level);
    else unknown = true;
  }
  const record = stored?.record;
  if (record !== undefined && record.kind !== 'own' && record.kind !== 'team') unknown = true;
  if (unknown) return { level: 'none', fields: new Map(), record: undefined };
  const level = stored?.level !== undefined && isObjectLevel(stored.level) ? stored.level : fallback;
  return {
    level,
    fields,
    record:
      record === undefined || (record.kind !== 'own' && record.kind !== 'team')
        ? undefined
        : { kind: record.kind, attributeId: record.attributeId },
  };
}

/**
 * The data policy the rules give a member (spec 0032, AC-843 to AC-845). Owners and admins are never restricted. A
 * member has one view of an object per subject that applies to them, their role and each of their teams. The
 * role's level is its rule, else `write`; a team's is its rule, else nothing (a team only grants). They get the
 * most open object level across their views, each field's most open level across the views that can see the
 * object (never above that view's own object level), and the broadest record scope across those views. A view
 * whose stored level or kind the code doesn't know sees nothing of the object (fail closed).
 */
function memberPolicy(principal: MemberPrincipal, rules: AccessRules): DataPolicy {
  // Owners and admins are never restricted by stored rules (AC-843): a rule can't name them (AC-842), and a team only
  // grants, so they keep the open policy and its audience. Only rules injected by hand (tests) name their role.
  const namesRole = (subject: RuleSubject) => subject.type === 'role' && subject.role === principal.role;
  if (
    (principal.role === 'owner' || principal.role === 'admin') &&
    !rules.levels.some((rule) => namesRole(rule.subject)) &&
    !rules.records.some((rule) => namesRole(rule.subject))
  ) {
    return OPEN_POLICY;
  }
  // The stored rules of every subject that applies, by subject ("role" or a team id) and then object.
  const stored = new Map<string, Map<string, StoredView>>();
  const storedOf = (subject: RuleSubject, objectId: string): StoredView | undefined => {
    if (!subjectMatches(subject, principal)) return undefined;
    const key = subject.type === 'role' ? 'role' : `team:${subject.teamId}`;
    let byObject = stored.get(key);
    if (byObject === undefined) {
      byObject = new Map();
      stored.set(key, byObject);
    }
    let view = byObject.get(objectId);
    if (view === undefined) {
      view = { level: undefined, fields: new Map(), record: undefined };
      byObject.set(objectId, view);
    }
    return view;
  };
  for (const rule of rules.levels) {
    const view = storedOf(rule.subject, rule.target.objectId);
    if (view === undefined) continue;
    if (rule.target.type === 'object') view.level = rule.level;
    else view.fields.set(rule.target.attributeId, rule.level);
  }
  for (const rule of rules.records) {
    const view = storedOf(rule.subject, rule.objectId);
    if (view !== undefined) view.record = { kind: rule.kind, attributeId: rule.attributeId };
  }
  // What the role gets on an object no rule names: `write` for a member, nothing for a role the list gives nothing.
  const defaultLevel = roleDefault(principal.role);
  const objectIds = new Set<string>();
  for (const byObject of stored.values()) for (const objectId of byObject.keys()) objectIds.add(objectId);
  const objects = new Map<string, ObjectLevel>();
  const fields = new Map<string, FieldLevel>();
  const records = new Map<string, RecordRule>();
  for (const objectId of objectIds) {
    // The role always has a view (its default when it holds no rule); a team has one only where it holds a rule.
    const views: SubjectView[] = [readView(stored.get('role')?.get(objectId), roleDefault(principal.role))];
    for (const [key, byObject] of stored) {
      if (key === 'role') continue;
      const team = byObject.get(objectId);
      if (team !== undefined) views.push(readView(team, 'none'));
    }
    const seeing = views.filter((view) => view.level !== 'none');
    if (seeing.length === 0) {
      objects.set(objectId, 'none');
      continue;
    }
    // The views that reach the most records decide: a view that sees every record (no record rule) outranks a team's
    // scope, which outranks one's own. The level comes from those views alone, so no one gets the level one rule gives
    // on the records of another (write on one's own records and view on all of them is view on all, never write on
    // all): at worst less than the union, never more.
    const reach = (view: SubjectView): number => (view.record === undefined ? 2 : SCOPE_RANK[view.record.kind]);
    const widest = Math.max(...seeing.map(reach));
    const deciding = seeing.filter((view) => reach(view) === widest);
    const level = capped(
      principal.role,
      deciding.reduce<ObjectLevel>((best, view) => higherObject(best, view.level), 'none'),
    );
    // A level equal to the role's default restricts nothing: leaving it out keeps a member whose teams cancel a rule
    // on the open policy (and its audience).
    if (level !== defaultLevel) objects.set(objectId, level);
    // A field some deciding view holds a rule for: the most open of those views, each capped at its own object level
    // (a view with no rule for the field gives its object's level).
    const fieldIds = new Set(deciding.flatMap((view) => [...view.fields.keys()]));
    for (const attributeId of fieldIds) {
      const best = deciding.reduce<FieldLevel>((most, view) => {
        const ofObject = FIELD_OF_OBJECT[view.level];
        return higherField(most, stricterField(view.fields.get(attributeId) ?? ofObject, ofObject));
      }, 'hidden');
      // A field as open as its object restricts nothing.
      if (FIELD_RANK[best] < FIELD_RANK[FIELD_OF_OBJECT[level]]) fields.set(attributeId, best);
    }
    // No deciding view with a record rule sees every record. Of the rules left, the lowest field id is the one kept.
    if (widest < 2) {
      let kept: RecordRule | undefined;
      for (const view of deciding) {
        const rule = view.record;
        if (rule !== undefined && (kept === undefined || rule.attributeId < kept.attributeId)) kept = rule;
      }
      if (kept !== undefined) records.set(objectId, Object.freeze({ kind: kept.kind, attributeId: kept.attributeId }));
    }
  }
  return sealPolicy({
    defaultObject: defaultLevel,
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
 * among its scopes, never one that stays with people (`KEY_FORBIDDEN_PERMISSIONS`), and a data
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

/**
 * A form's access (spec 0023, security model): no permission at all; write
 * on its main object, and on that object's attributes only those its
 * published mapping names (`writable`); every other attribute of the object
 * hidden, and every other object out of reach. With no object (the public
 * endpoints, before processing) it reaches no data at all. A form filing
 * People also files the person's company by their email (spec 0059,
 * AC-5916): `filing` adds write on Companies with every attribute filing
 * never writes hidden (`unwritten`: all but Domains and Name), and on the
 * person's Company attribute, and nothing else.
 */
export function formAccess(
  formId: string,
  target?: {
    readonly objectId: string;
    readonly attributeIds: readonly string[];
    readonly writable: ReadonlySet<string>;
    readonly filing?: {
      readonly companies: string;
      readonly companyAttributeId: string;
      readonly unwritten: readonly string[];
    };
  },
): Access {
  const filing = target?.filing;
  const fields: [string, FieldLevel][] =
    target === undefined
      ? []
      : [
          ...target.attributeIds.flatMap((id): [string, FieldLevel][] =>
            target.writable.has(id) || id === filing?.companyAttributeId ? [] : [[id, 'hidden']],
          ),
          ...(filing?.unwritten ?? []).map((id): [string, FieldLevel] => [id, 'hidden']),
        ];
  const objects: [string, ObjectLevel][] =
    target === undefined
      ? []
      : [
          [target.objectId, 'write'],
          ...(filing === undefined ? [] : [[filing.companies, 'write'] as [string, ObjectLevel]]),
        ];
  return Object.freeze({
    principal: Object.freeze({ kind: 'form', formId }),
    permissions: Object.freeze([]),
    data: sealPolicy({
      defaultObject: 'none',
      objects: frozenRecord(objects),
      fields: frozenRecord(fields),
      records: frozenRecord([]),
    }),
  });
}

/**
 * A booking page's access (spec 0025, AC-634): no permission, and write on
 * the objects a booking matches and makes records on (People and Companies),
 * nothing on any other. Only the door's `enterBookingPage` builds one.
 */
export function bookingAccess(pageId: string, objectIds: readonly string[]): Access {
  return Object.freeze({
    principal: Object.freeze({ kind: 'booking', pageId }),
    permissions: Object.freeze([]),
    data: sealPolicy({
      defaultObject: 'none',
      objects: frozenRecord(objectIds.map((objectId) => [objectId, 'write' as const])),
      fields: frozenRecord([]),
      records: frozenRecord([]),
    }),
  });
}

/**
 * A member reached through an email's preferences link (the emails lane): an
 * `email_link` principal with no role, no permission and no object, so every
 * member service refuses it and only their own email preferences take it.
 * Only the door's `enterEmailLink` builds one.
 */
export function emailLinkAccess(memberId: string): Access {
  return Object.freeze({
    principal: Object.freeze({ kind: 'email_link', memberId }),
    permissions: Object.freeze([]),
    data: sealPolicy({
      defaultObject: 'none',
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

/**
 * True when the policy restricts nothing (every object and field at write, no
 * record rule): the engine then adds no check and no SQL at all, so the open
 * policy's statements stay as they were (AC-149).
 */
export function isOpen(access: Pick<Access, 'data'>): boolean {
  return access.data.key === OPEN_KEY;
}

/**
 * The members a record rule matches for this principal: the member themself for `own`, and for `team` the members
 * of their teams, themself included (spec 0032, AC-847). A member in no team matches themself alone, so a team scope
 * never shows less than their own; a principal that isn't a member matches nobody (fail closed).
 */
export function ruleMembers(access: Pick<Access, 'principal'>, rule: RecordRule): readonly string[] {
  const { principal } = access;
  if (principal.kind !== 'member') return [];
  if (rule.kind === 'own') return [principal.memberId];
  return [...new Set([principal.memberId, ...(principal.teamMemberIds ?? [])])];
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
  if (fieldLevel(access, attribute) === 'read') return fieldReadOnlyReason(attribute.title);
  return undefined;
}

/** Why a field rule leaves an attribute read only: "Your role can't change <title>." */
export function fieldReadOnlyReason(title: string): string {
  return `Your role can't change ${title}.`;
}
