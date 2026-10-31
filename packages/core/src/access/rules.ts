// Access rules by role and team, as an object's Access tab edits them (spec 0032, milestones 1 and 3, AC-846 to
// AC-852): for one object, what the Member role and each team may do (nothing, view, edit) and which of its records
// they see (all, the ones that name them, the ones that name their team). Owners and admins are never restricted, so
// nobody who manages access can be locked out of the data (AC-843).
//
// One rule per subject and object. A set replaces what the subject had in one transaction; setting the same thing
// again changes nothing and writes no audit row (AC-851). The Member role with edit on all records is the default, so
// it is stored as no rule at all; a team only grants, so a team with no access is no row either. The record scope
// reads the object's Owner (its Member field with the API name `owner`, else its first Member field): without one
// there is nothing to scope by, and the scope is refused (guard at creation: the Access tab offers it only when the
// object has one). Every change stores the audit row and one `access` outbox row naming the members the subject
// covers, so their screens read again (AC-852).
//
// Field rules (milestone 2, AC-846, AC-850): a subject may also have a rule per field, read only or hidden, stored as
// `access_rules` rows with an attribute. They are read by the same policy as the object level (a field is never more
// open than its object), so the door enforces them everywhere with no code of its own. A set reports what it takes
// away from people who had it (`AccessImpact`), computed from the policy before and after, in the same transaction.
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  FIELD_RULE_LEVELS,
  OBJECT_ACCESS_LEVELS,
  RECORD_SCOPES,
  ROLE_DEFAULT_LEVEL,
  RuleRole,
  ViewConfig,
  filterAttributeIds,
  type AccessImpact,
  type FieldRuleLevel,
  type FieldRules,
  type ObjectAccess,
  type ObjectAccessLevel,
  type OwnerAttribute,
  type RecordScope,
  type RuleSubject,
  type SetObjectAccessResult,
  type SubjectAccess,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { checkId } from '../engine/ids.ts';
import { filedBy, liveFormsOn } from '../forms/dependencies.ts';
import { inputInvalid, refuse } from '../engine/refusals.ts';
import { actorRow } from '../engine/scope.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { writeAudit, type AuditSource } from '../members/audit.ts';
import { requirePermission } from './check.ts';
import type { EngineScope } from './mint.ts';
import {
  fieldLevel,
  isRole,
  objectLevel,
  recordRule,
  roleAccess,
  type Access,
  type AccessRules,
  type LevelRule,
  type RecordRuleRow,
} from './policy.ts';
import { inWorkspace } from './run.ts';
import { workspaceRules } from './stored-rules.ts';

const { accessRules, attributes, members, objects, recordRules, teamMembers, teams, views } = schema;

const OBJECT_NOT_FOUND = "That object doesn't exist.";
const TEAM_NOT_FOUND = "That team doesn't exist.";
const FIELD_NOT_FOUND = "That field doesn't exist.";

/** What setting one subject's access takes: a level and a record scope, or `null` to clear it. */
export interface ObjectAccessRule {
  readonly level: ObjectAccessLevel;
  readonly records: RecordScope;
  /** The subject's field rules; left out, the ones it has stay. */
  readonly fields?: FieldRules;
}

/** What every rule write takes beside its input: where the request came from, for the audit row. */
export interface AccessRuleOptions {
  readonly source?: AuditSource;
}

const isLevel = (value: string): value is ObjectAccessLevel =>
  (OBJECT_ACCESS_LEVELS as readonly string[]).includes(value);
const isScope = (value: string): value is RecordScope => (RECORD_SCOPES as readonly string[]).includes(value);
const isFieldLevel = (value: string): value is FieldRuleLevel =>
  (FIELD_RULE_LEVELS as readonly string[]).includes(value);

/**
 * The field a record scope reads for `objectId`: its live, non system Member field with the API name `owner`, else
 * the first by position. Undefined when the object has none.
 */
export async function ownerAttributeOf(tx: WorkspaceTx, objectId: string): Promise<OwnerAttribute | undefined> {
  const [found] = await tx
    .select({ id: attributes.id, title: attributes.title })
    .from(attributes)
    .where(
      and(
        eq(attributes.objectId, objectId),
        eq(attributes.type, 'actor_reference'),
        eq(attributes.isSystem, false),
        isNull(attributes.archivedAt),
      ),
    )
    .orderBy(sql`(${attributes.apiSlug} = 'owner') desc`, asc(attributes.position), asc(attributes.id))
    .limit(1);
  return found;
}

/** How many active members each role covers, and how many are in each team. */
async function peopleCounts(tx: WorkspaceTx, workspaceId: string, teamIds: readonly string[]) {
  const roles = await tx
    .select({ role: members.role, n: sql<number>`count(*)::int` })
    .from(members)
    .where(and(eq(members.workspaceId, workspaceId), eq(members.status, 'active')))
    .groupBy(members.role);
  const byRole = new Map<string, number>(roles.map((row) => [row.role, row.n]));
  const byTeam = new Map<string, number>();
  if (teamIds.length > 0) {
    const rows = await tx
      .select({ teamId: teamMembers.teamId, n: sql<number>`count(*)::int` })
      .from(teamMembers)
      .innerJoin(members, and(eq(members.workspaceId, teamMembers.workspaceId), eq(members.id, teamMembers.memberId)))
      .where(
        and(
          eq(teamMembers.workspaceId, workspaceId),
          inArray(teamMembers.teamId, [...teamIds]),
          eq(members.status, 'active'),
        ),
      )
      .groupBy(teamMembers.teamId);
    for (const row of rows) byTeam.set(row.teamId, row.n);
  }
  return { byRole, byTeam };
}

/** The stored rows of one subject, read as the code reads them (an unknown level is nothing, a kind other than own or team is all). */
interface Stored {
  readonly level: string | undefined;
  readonly kind: string | undefined;
  /** Its field rules as stored text. */
  readonly fields: ReadonlyMap<string, string>;
}

/** A field rule as shown: fail closed, so a level the code doesn't know reads as hidden. */
const fieldShown = (level: string): FieldRuleLevel => (isFieldLevel(level) ? level : 'hidden');

/** What `getObjectAccess` shows for a stored level and kind: fail closed, so a level the code doesn't know reads as none. */
function shown(
  stored: Stored,
  fallback: ObjectAccessLevel,
): {
  level: ObjectAccessLevel;
  records: RecordScope;
  defaultLevel: ObjectAccessLevel;
  isDefault: boolean;
  fields: FieldRules;
} {
  const fields: FieldRules = Object.fromEntries([...stored.fields].map(([id, level]) => [id, fieldShown(level)]));
  if (stored.level === undefined && stored.kind === undefined) {
    return { level: fallback, records: 'all', defaultLevel: fallback, isDefault: stored.fields.size === 0, fields };
  }
  const level = stored.level === undefined ? fallback : isLevel(stored.level) ? stored.level : 'none';
  const records: RecordScope =
    level !== 'none' && stored.kind !== undefined && isScope(stored.kind) && stored.kind !== 'all'
      ? stored.kind
      : 'all';
  return { level, records, defaultLevel: fallback, isDefault: false, fields };
}

/** One attribute's id and title, for the field a record scope reads. */
async function attributeNamed(tx: WorkspaceTx, workspaceId: string, id: string): Promise<OwnerAttribute | undefined> {
  const [found] = await tx
    .select({ id: attributes.id, title: attributes.title })
    .from(attributes)
    .where(and(eq(attributes.workspaceId, workspaceId), eq(attributes.id, id)));
  return found;
}

/** Reads an object's access inside `tx`: each rule role in the roles list's order, then each team that has a rule. */
async function readAccess(tx: WorkspaceTx, workspaceId: string, objectId: string): Promise<ObjectAccess> {
  const [object] = await tx
    .select({ id: objects.id, primaryAttributeId: objects.primaryAttributeId })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.id, objectId)));
  if (object === undefined) throw refuse('NOT_FOUND', OBJECT_NOT_FOUND);
  const levelRows = await tx
    .select({
      role: accessRules.subjectRole,
      teamId: accessRules.subjectTeamId,
      attributeId: accessRules.attributeId,
      level: accessRules.level,
    })
    .from(accessRules)
    .where(and(eq(accessRules.workspaceId, workspaceId), eq(accessRules.objectId, objectId)));
  const recordRows = await tx
    .select({
      role: recordRules.subjectRole,
      teamId: recordRules.subjectTeamId,
      kind: recordRules.kind,
      attributeId: recordRules.attributeId,
    })
    .from(recordRules)
    .where(and(eq(recordRules.workspaceId, workspaceId), eq(recordRules.objectId, objectId)));
  // The field the object's record rules read, when it has any: every rule of one object reads the same field, so a
  // second Owner field made later never splits them (the tab names the field in use, not the one that would win now).
  const inUse = recordRows[0]?.attributeId;
  const owner =
    inUse === undefined ? await ownerAttributeOf(tx, objectId) : await attributeNamed(tx, workspaceId, inUse);
  const fieldRows = await tx
    .select({ id: attributes.id, title: attributes.title })
    .from(attributes)
    .where(
      and(eq(attributes.workspaceId, workspaceId), eq(attributes.objectId, objectId), isNull(attributes.archivedAt)),
    )
    .orderBy(asc(attributes.position), asc(attributes.id));
  const teamIds = [
    ...new Set([...levelRows, ...recordRows].flatMap((row) => (row.teamId === null ? [] : [row.teamId]))),
  ];
  const names =
    teamIds.length === 0
      ? []
      : await tx
          .select({ id: teams.id, name: teams.name })
          .from(teams)
          .where(and(eq(teams.workspaceId, workspaceId), inArray(teams.id, teamIds)));
  const people = await peopleCounts(tx, workspaceId, teamIds);
  const storedOf = (matches: (row: { role: string | null; teamId: string | null }) => boolean): Stored => ({
    level: levelRows.find((row) => row.attributeId === null && matches(row))?.level,
    kind: recordRows.find((row) => matches(row))?.kind,
    fields: new Map(
      levelRows.flatMap((row): [string, string][] =>
        row.attributeId !== null && matches(row) ? [[row.attributeId, row.level]] : [],
      ),
    ),
  });
  const subjects: SubjectAccess[] = RuleRole.options.map((role) => ({
    subject: { type: 'role', role },
    ...shown(
      storedOf((row) => row.role === role),
      ROLE_DEFAULT_LEVEL[role],
    ),
    people: people.byRole.get(role) ?? 0,
  }));
  for (const team of [...names].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))) {
    subjects.push({
      subject: { type: 'team', teamId: team.id },
      ...shown(
        storedOf((row) => row.teamId === team.id),
        'none',
      ),
      people: people.byTeam.get(team.id) ?? 0,
    });
  }
  return {
    objectId,
    fields: fieldRows.map((row) => ({ id: row.id, title: row.title, isPrimary: row.id === object.primaryAttributeId })),
    ...(owner === undefined ? {} : { ownerAttribute: owner }),
    subjects,
  };
}

/**
 * An object's access (spec 0032, AC-851): what each role a rule can be about may do with it (members edit all records
 * unless a rule says otherwise), then each team with a rule, each with its field rules and how many people it covers;
 * and the field a record scope reads. Needs `access.manage`.
 */
export async function getObjectAccess(scope: EngineScope, input: { readonly objectId: string }): Promise<ObjectAccess> {
  requirePermission(scope, 'access.manage');
  const objectId = checkId(input.objectId, OBJECT_NOT_FOUND);
  return inWorkspace(scope, (tx) => readAccess(tx, scope.workspaceId, objectId));
}

/** Whether two field rule sets say the same thing. */
const sameFields = (a: FieldRules, b: FieldRules): boolean => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
};

/** Whether two subjects' standing is the same thing, so a repeated set writes nothing. */
const same = (a: SubjectAccess | undefined, b: SubjectAccess | undefined): boolean =>
  a !== undefined &&
  b !== undefined &&
  a.level === b.level &&
  a.records === b.records &&
  a.isDefault === b.isDefault &&
  sameFields(a.fields, b.fields);

/** The role a subject names, as plain text: the roles list grows (Guest), so a role is compared as a name. */
const roleOf = (subject: RuleSubject): string | undefined => (subject.type === 'role' ? subject.role : undefined);

/** The standing of `subject` in `access`, or undefined when it has none. */
function standing(access: ObjectAccess, subject: RuleSubject): SubjectAccess | undefined {
  return access.subjects.find((each) =>
    subject.type === 'role'
      ? roleOf(each.subject) === roleOf(subject)
      : each.subject.type === 'team' && each.subject.teamId === subject.teamId,
  );
}

/** The rows a subject's rule is stored as, in the policy's own shapes, so the impact reads them as the door would. */
interface RuleRows {
  readonly levels: readonly LevelRule[];
  readonly records: readonly RecordRuleRow[];
}

/**
 * What a rule stores for a subject on an object: an object level unless it is the role's default (or a team with
 * nothing), a field row for each field rule (none for a team with nothing to grant), and a record rule for a scope.
 */
function rowsOf(
  subject: RuleSubject,
  objectId: string,
  stored: { readonly level: ObjectAccessLevel; readonly records: RecordScope; readonly fields: FieldRules } | undefined,
  ownerId: string | undefined,
): RuleRows {
  if (stored === undefined) return { levels: [], records: [] };
  const { level, records, fields } = stored;
  const roleDefault = subject.type === 'role' ? ROLE_DEFAULT_LEVEL[subject.role] : undefined;
  const isTeamWithNothing = subject.type === 'team' && level === 'none';
  const storesLevel = !isTeamWithNothing && !(roleDefault !== undefined && level === roleDefault && records === 'all');
  const levels: LevelRule[] = [];
  if (storesLevel) levels.push({ subject, target: { type: 'object', objectId }, level });
  if (!isTeamWithNothing) {
    for (const [attributeId, fieldRule] of Object.entries(fields)) {
      levels.push({ subject, target: { type: 'attribute', objectId, attributeId }, level: fieldRule });
    }
  }
  const recordRows: RecordRuleRow[] =
    storesLevel && records !== 'all' && ownerId !== undefined
      ? [{ subject, objectId, kind: records, attributeId: ownerId }]
      : [];
  return { levels, records: recordRows };
}

/** Whether a rule row is about this subject. */
const aboutSubject = (rowSubject: LevelRule['subject'], subject: RuleSubject): boolean =>
  subject.type === 'role'
    ? rowSubject.type === 'role' && rowSubject.role === subject.role
    : rowSubject.type === 'team' && rowSubject.teamId === subject.teamId;

const LEVEL_RANK: Readonly<Record<string, number>> = { none: 0, hidden: 0, read: 1, write: 2 };

/** How many records a policy reaches on an object, for comparing before and after: all over a team's over one's own. */
const reachOf = (access: Access, objectId: string): number => {
  const rule = recordRule(access, objectId);
  return rule === undefined ? 2 : rule.kind === 'team' ? 1 : 0;
};

/** The attribute ids a saved view names: columns, sorts, filter, grouping and a board's settings. */
function viewAttributeIds(config: unknown): readonly string[] {
  const parsed = ViewConfig.safeParse(config);
  if (!parsed.success) return [];
  const c = parsed.data;
  return [
    ...c.columns.map((column) => column.attributeId),
    ...c.sorts.map((sort) => sort.attributeId),
    ...filterAttributeIds(c.filter),
    ...(c.groupBy === undefined ? [] : [c.groupBy]),
    ...(c.board === undefined
      ? []
      : [
          c.board.groupByAttributeId,
          ...c.board.cardFields,
          ...(c.board.totalAttributeId === undefined ? [] : [c.board.totalAttributeId]),
        ]),
  ];
}

/**
 * What a change to one subject's rules takes away from the people it covers (spec 0032, AC-850): each covered member's
 * policy before and after, from the same function the door uses; a member loses something when the object's level,
 * the records they reach or any field's level goes down. Counts those people, the shared views that name a field
 * some of them lost (all of the object's, when some lost the object), and the live forms filing onto such a field.
 */
async function impactOf(
  tx: WorkspaceTx,
  scope: EngineScope,
  objectId: string,
  subject: RuleSubject,
  next: RuleRows,
  covered: readonly string[],
): Promise<AccessImpact> {
  const none: AccessImpact = { people: 0, views: 0, forms: 0 };
  if (covered.length === 0) return none;
  const all = await workspaceRules(tx);
  // In chunks, so a role that covers tens of thousands never meets Postgres's limit on bound values.
  const rows: { id: string; role: string }[] = [];
  for (let at = 0; at < covered.length; at += 5000) {
    rows.push(
      ...(await tx
        .select({ id: members.id, role: members.role })
        .from(members)
        .where(
          and(
            eq(members.workspaceId, scope.workspaceId),
            eq(members.status, 'active'),
            inArray(members.id, covered.slice(at, at + 5000)),
          ),
        )),
    );
  }
  const fieldIds = (
    await tx
      .select({ id: attributes.id })
      .from(attributes)
      .where(
        and(
          eq(attributes.workspaceId, scope.workspaceId),
          eq(attributes.objectId, objectId),
          isNull(attributes.archivedAt),
        ),
      )
  ).map((row) => row.id);
  const after = (rules: AccessRules): AccessRules => ({
    ...rules,
    levels: [
      ...rules.levels.filter((rule) => !(aboutSubject(rule.subject, subject) && rule.target.objectId === objectId)),
      ...next.levels,
    ],
    records: [
      ...rules.records.filter((rule) => !(aboutSubject(rule.subject, subject) && rule.objectId === objectId)),
      ...next.records,
    ],
  });
  // Members with the same role and teams get the same verdict (nothing here depends on who they are), so each
  // distinct pair is worked out once, however many people it covers.
  const verdicts = new Map<
    string,
    { readonly less: boolean; readonly gone: boolean; readonly lost: readonly string[] }
  >();
  let people = 0;
  let gone = false;
  const lost = new Set<string>();
  for (const row of rows) {
    if (!isRole(row.role)) continue;
    const teamIds = all.teamIdsOf(row.id);
    const key = `${row.role}|${teamIds.join(',')}`;
    let verdict = verdicts.get(key);
    if (verdict === undefined) {
      const rules: AccessRules = { levels: all.levels, records: all.records, teamIds, teamMemberIds: [] };
      const principal = { kind: 'member', memberId: row.id, role: row.role, teamIds, teamMemberIds: [] } as const;
      const was = roleAccess(principal, rules);
      const now = roleAccess(principal, after(rules));
      let less = false;
      let objectGone = false;
      if ((LEVEL_RANK[objectLevel(now, objectId)] ?? 0) < (LEVEL_RANK[objectLevel(was, objectId)] ?? 0)) {
        less = true;
        objectGone = objectLevel(now, objectId) === 'none';
      }
      if (reachOf(now, objectId) < reachOf(was, objectId)) less = true;
      const hidden: string[] = [];
      for (const id of fieldIds) {
        const before = fieldLevel(was, { id, objectId });
        const level = fieldLevel(now, { id, objectId });
        if ((LEVEL_RANK[level] ?? 0) < (LEVEL_RANK[before] ?? 0)) {
          less = true;
          if (level === 'hidden') hidden.push(id);
        }
      }
      verdict = { less, gone: objectGone, lost: hidden };
      verdicts.set(key, verdict);
    }
    if (!verdict.less) continue;
    people += 1;
    gone ||= verdict.gone;
    for (const id of verdict.lost) lost.add(id);
  }
  if (people === 0) return none;
  // The shared views the object has that name a field some of them can no longer see (or, with the object gone, all).
  const shared = await tx
    .select({ config: views.config })
    .from(views)
    .where(
      and(eq(views.workspaceId, scope.workspaceId), eq(views.objectId, objectId), eq(views.visibility, 'workspace')),
    )
    .limit(500);
  const viewCount = gone
    ? shared.length
    : shared.filter((view) => viewAttributeIds(view.config).some((id) => lost.has(id))).length;
  const live = await liveFormsOn(tx, scope.access, objectId);
  const formCount = gone
    ? live.length
    : live.filter((form) => [...filedBy(form.document)].some((id) => lost.has(id))).length;
  return { people, views: viewCount, forms: formCount };
}

/**
 * Sets one subject's access to an object (spec 0032, AC-846 to AC-852). `rule` replaces what the subject had (its
 * field rules too when it carries them); `null` clears it (a team row goes, a role returns to its default). Only a
 * role the roles list says a rule can be about (`RuleRole`: not an owner or an admin) and a team can be a subject,
 * never a person: 422 `CONFIG_INVALID`. A record scope of `own` or `team` needs the object to have a Member field to
 * read, else it is refused `CONFIG_INVALID`; a field rule names a live field of this object, and the record's name
 * field is never hidden (`CONFIG_INVALID`). Answers the object's access as it stands and what the change took away
 * from people who had it. Needs `access.manage`.
 */
export async function setObjectAccess(
  scope: EngineScope,
  input: { readonly objectId: string; readonly subject: RuleSubject; readonly rule: ObjectAccessRule | null },
  hooks: readonly AfterWrite[] = [],
  options: AccessRuleOptions = {},
): Promise<SetObjectAccessResult> {
  requirePermission(scope, 'access.manage');
  const objectId = checkId(input.objectId, OBJECT_NOT_FOUND);
  const { subject, rule } = input;
  if (subject.type === 'role' && !RuleRole.safeParse(subject.role).success) {
    throw refuse('CONFIG_INVALID', 'Rules are for members and teams. Owners and admins always see everything.');
  }
  if (rule !== null && (!isLevel(rule.level) || !isScope(rule.records))) {
    throw inputInvalid('rule', 'Pick no access, view or edit, and which records.');
  }
  // A guest views at most (spec 0031, AC-828); the policy caps them too, so a stored edit could never reach them.
  if (subject.type === 'role' && subject.role === 'guest' && rule?.level === 'write') {
    throw refuse('CONFIG_INVALID', 'Guests can view, never edit.');
  }
  // Field rules by canonical id, each a level the code knows.
  const givenFields: FieldRules | undefined =
    rule?.fields === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(rule.fields).map(([attributeId, level]) => {
            if (!isFieldLevel(level)) throw inputInvalid('rule', 'Pick read only or hidden for a field.');
            return [checkId(attributeId, FIELD_NOT_FOUND), level];
          }),
        );
  const teamId = subject.type === 'team' ? checkId(subject.teamId, TEAM_NOT_FOUND) : undefined;
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      // Two sets for one object take turns, so neither meets the other's half written rule on the unique index.
      await tx
        .select({ id: objects.id })
        .from(objects)
        .where(and(eq(objects.workspaceId, scope.workspaceId), eq(objects.id, objectId)))
        .for('no key update');
      const before = await readAccess(tx, scope.workspaceId, objectId);
      let teamName: string | undefined;
      if (teamId !== undefined) {
        const [team] = await tx
          .select({ name: teams.name })
          .from(teams)
          .where(and(eq(teams.workspaceId, scope.workspaceId), eq(teams.id, teamId)))
          .for('share');
        if (team === undefined) throw refuse('NOT_FOUND', TEAM_NOT_FOUND);
        teamName = team.name;
      }
      const was = standing(before, subject);
      // A subject with no access to the object has no records to scope; a team with none grants nothing.
      const level = rule?.level ?? 'none';
      const records: RecordScope = level === 'none' ? 'all' : (rule?.records ?? 'all');
      const owner = before.ownerAttribute;
      if (records !== 'all' && owner === undefined) {
        throw refuse('CONFIG_INVALID', 'This object has no Member field to share records by. Add one first.');
      }
      // Field rules: those given, else the ones the subject has (a null rule clears them). Each names a live field of
      // this object (one already stored may have been archived since), and the record's name is never hidden.
      const given = givenFields;
      const fields: FieldRules = rule === null ? {} : (given ?? was?.fields ?? {});
      if (given !== undefined) {
        const live = new Set(before.fields.map((field) => field.id));
        for (const [attributeId, fieldRule] of Object.entries(given)) {
          if (!live.has(attributeId) && was?.fields[attributeId] === undefined) {
            throw refuse('CONFIG_INVALID', FIELD_NOT_FOUND, attributeId);
          }
          if (fieldRule === 'hidden' && before.fields.some((field) => field.id === attributeId && field.isPrimary)) {
            throw refuse('CONFIG_INVALID', "A record's name can't be hidden.", attributeId);
          }
        }
      }
      const next = rowsOf(subject, objectId, rule === null ? undefined : { level, records, fields }, owner?.id);
      const roleDefault = subject.type === 'role' ? ROLE_DEFAULT_LEVEL[subject.role] : undefined;
      const stores = next.levels.length > 0 || next.records.length > 0;
      const nextStanding: SubjectAccess = {
        subject,
        level: next.levels.some((row) => row.target.type === 'object') ? level : (roleDefault ?? 'none'),
        records: next.records.length > 0 ? records : 'all',
        defaultLevel: roleDefault ?? 'none',
        isDefault: !stores,
        fields: Object.fromEntries(
          next.levels.flatMap((row): [string, FieldRuleLevel][] =>
            row.target.type === 'attribute' && isFieldLevel(row.level) ? [[row.target.attributeId, row.level]] : [],
          ),
        ),
        people: was?.people ?? 0,
      };
      const nothing: AccessImpact = { people: 0, views: 0, forms: 0 };
      if (same(was, nextStanding) || (was === undefined && !stores)) return { access: before, impact: nothing };
      const covered =
        subject.type === 'role'
          ? await tx
              .select({ id: members.id })
              .from(members)
              .where(
                and(
                  eq(members.workspaceId, scope.workspaceId),
                  eq(members.status, 'active'),
                  eq(members.role, subject.role),
                ),
              )
          : await tx
              .select({ id: teamMembers.memberId })
              .from(teamMembers)
              .where(and(eq(teamMembers.workspaceId, scope.workspaceId), eq(teamMembers.teamId, subject.teamId)));
      const coveredIds = covered.map((row) => row.id);
      // What this takes away is read from the policy as it stands, before a row changes.
      const impact = await impactOf(tx, scope, objectId, subject, next, coveredIds);
      const subjectWhere = (table: typeof accessRules | typeof recordRules) =>
        subject.type === 'role' ? eq(table.subjectRole, subject.role) : eq(table.subjectTeamId, subject.teamId);
      await tx
        .delete(accessRules)
        .where(
          and(
            eq(accessRules.workspaceId, scope.workspaceId),
            eq(accessRules.objectId, objectId),
            subjectWhere(accessRules),
          ),
        );
      await tx
        .delete(recordRules)
        .where(
          and(
            eq(recordRules.workspaceId, scope.workspaceId),
            eq(recordRules.objectId, objectId),
            subjectWhere(recordRules),
          ),
        );
      const by = actorRow(scope.actor);
      const stamp = {
        createdByType: by.type,
        createdById: by.id,
        createdByMemberId: by.memberId,
        updatedByType: by.type,
        updatedById: by.id,
        updatedByMemberId: by.memberId,
      };
      const who =
        subject.type === 'role'
          ? { subjectType: 'role', subjectRole: subject.role }
          : { subjectType: 'team', subjectTeamId: subject.teamId };
      for (const row of next.levels) {
        await tx.insert(accessRules).values({
          workspaceId: scope.workspaceId,
          objectId,
          ...who,
          attributeId: row.target.type === 'attribute' ? row.target.attributeId : null,
          level: row.level,
          ...stamp,
        });
      }
      for (const row of next.records) {
        await tx.insert(recordRules).values({
          workspaceId: scope.workspaceId,
          objectId,
          ...who,
          kind: row.kind,
          attributeId: row.attributeId,
          ...stamp,
        });
      }
      const [object] = await tx
        .select({ name: objects.pluralName })
        .from(objects)
        .where(and(eq(objects.workspaceId, scope.workspaceId), eq(objects.id, objectId)));
      const titles = new Map(before.fields.map((field) => [field.id, field.title]));
      const named = (rules: FieldRules | undefined) =>
        rules === undefined || Object.keys(rules).length === 0
          ? undefined
          : Object.fromEntries(Object.entries(rules).map(([id, fieldRule]) => [titles.get(id) ?? id, fieldRule]));
      const side = (standingOf: SubjectAccess | undefined) => ({
        level: standingOf?.level,
        records: standingOf?.records,
        fields: named(standingOf?.fields),
      });
      await writeAudit(
        tx,
        scope.workspaceId,
        scope.actor,
        {
          action: 'access.rule_set',
          targetType: 'object',
          targetId: objectId,
          before: { ...side(was), isDefault: was?.isDefault },
          after: {
            object: object?.name,
            subject: subject.type === 'role' ? subject.role : 'team',
            ...(teamId === undefined ? {} : { teamId, team: teamName }),
            ...side(nextStanding),
            isDefault: nextStanding.isDefault,
          },
        },
        options.source,
      );
      // Everyone the subject covers reads their access again, and the relay drops the workspace's audiences.
      context.record({ access: coveredIds });
      return { access: await readAccess(tx, scope.workspaceId, objectId), impact };
    },
    hooks,
  );
  return result;
}
