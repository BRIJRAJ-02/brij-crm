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
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  OBJECT_ACCESS_LEVELS,
  RECORD_SCOPES,
  ROLE_DEFAULT_LEVEL,
  RuleRole,
  type ObjectAccess,
  type ObjectAccessLevel,
  type OwnerAttribute,
  type RecordScope,
  type RuleSubject,
  type SubjectAccess,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { checkId } from '../engine/ids.ts';
import { inputInvalid, refuse } from '../engine/refusals.ts';
import { actorRow } from '../engine/scope.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { writeAudit, type AuditSource } from '../members/audit.ts';
import { requirePermission } from './check.ts';
import type { EngineScope } from './mint.ts';
import { inWorkspace } from './run.ts';

const { accessRules, attributes, members, objects, recordRules, teamMembers, teams } = schema;

const OBJECT_NOT_FOUND = "That object doesn't exist.";
const TEAM_NOT_FOUND = "That team doesn't exist.";

/** What setting one subject's access takes: a level and a record scope, or `null` to clear it. */
export interface ObjectAccessRule {
  readonly level: ObjectAccessLevel;
  readonly records: RecordScope;
}

/** What every rule write takes beside its input: where the request came from, for the audit row. */
export interface AccessRuleOptions {
  readonly source?: AuditSource;
}

const isLevel = (value: string): value is ObjectAccessLevel =>
  (OBJECT_ACCESS_LEVELS as readonly string[]).includes(value);
const isScope = (value: string): value is RecordScope => (RECORD_SCOPES as readonly string[]).includes(value);

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
}

/** What `getObjectAccess` shows for a stored level and kind: fail closed, so a level the code doesn't know reads as none. */
function shown(
  stored: Stored,
  fallback: ObjectAccessLevel,
): { level: ObjectAccessLevel; records: RecordScope; defaultLevel: ObjectAccessLevel; isDefault: boolean } {
  if (stored.level === undefined && stored.kind === undefined) {
    return { level: fallback, records: 'all', defaultLevel: fallback, isDefault: true };
  }
  const level = stored.level === undefined ? fallback : isLevel(stored.level) ? stored.level : 'none';
  const records: RecordScope =
    level !== 'none' && stored.kind !== undefined && isScope(stored.kind) && stored.kind !== 'all'
      ? stored.kind
      : 'all';
  return { level, records, defaultLevel: fallback, isDefault: false };
}

/** Reads an object's access inside `tx`: each rule role in the roles list's order, then each team that has a rule. */
async function readAccess(tx: WorkspaceTx, workspaceId: string, objectId: string): Promise<ObjectAccess> {
  const [object] = await tx
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.id, objectId)));
  if (object === undefined) throw refuse('NOT_FOUND', OBJECT_NOT_FOUND);
  const owner = await ownerAttributeOf(tx, objectId);
  const levelRows = await tx
    .select({ role: accessRules.subjectRole, teamId: accessRules.subjectTeamId, level: accessRules.level })
    .from(accessRules)
    .where(
      and(
        eq(accessRules.workspaceId, workspaceId),
        eq(accessRules.objectId, objectId),
        isNull(accessRules.attributeId),
      ),
    );
  const recordRows = await tx
    .select({ role: recordRules.subjectRole, teamId: recordRules.subjectTeamId, kind: recordRules.kind })
    .from(recordRules)
    .where(and(eq(recordRules.workspaceId, workspaceId), eq(recordRules.objectId, objectId)));
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
  const subjects: SubjectAccess[] = RuleRole.options.map((role) => ({
    subject: { type: 'role', role },
    ...shown(
      {
        level: levelRows.find((row) => row.role === role)?.level,
        kind: recordRows.find((row) => row.role === role)?.kind,
      },
      ROLE_DEFAULT_LEVEL[role],
    ),
    people: people.byRole.get(role) ?? 0,
  }));
  for (const team of [...names].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))) {
    const stored: Stored = {
      level: levelRows.find((row) => row.teamId === team.id)?.level,
      kind: recordRows.find((row) => row.teamId === team.id)?.kind,
    };
    subjects.push({
      subject: { type: 'team', teamId: team.id },
      ...shown(stored, 'none'),
      people: people.byTeam.get(team.id) ?? 0,
    });
  }
  return { objectId, ...(owner === undefined ? {} : { ownerAttribute: owner }), subjects };
}

/**
 * An object's access (spec 0032, AC-851): what each role a rule can be about may do with it (members edit all records
 * unless a rule says otherwise), then each team with a rule, each with how many people it covers; and the field a record scope would
 * read. Needs `access.manage`.
 */
export async function getObjectAccess(scope: EngineScope, input: { readonly objectId: string }): Promise<ObjectAccess> {
  requirePermission(scope, 'access.manage');
  const objectId = checkId(input.objectId, OBJECT_NOT_FOUND);
  return inWorkspace(scope, (tx) => readAccess(tx, scope.workspaceId, objectId));
}

/** Whether two subjects' standing is the same thing, so a repeated set writes nothing. */
const same = (a: SubjectAccess | undefined, b: SubjectAccess | undefined): boolean =>
  a !== undefined && b !== undefined && a.level === b.level && a.records === b.records && a.isDefault === b.isDefault;

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

/**
 * Sets one subject's access to an object (spec 0032, AC-846 to AC-852). `rule` replaces what the subject had; `null`
 * clears it (a team row goes, a role returns to its default). Only a role the roles list says a rule can be about
 * (`RuleRole`: not an owner or an admin) and a team can be a subject, never a person: 422 `CONFIG_INVALID`. A record scope of `own` or `team` needs the
 * object to have a Member field to read, else it is refused `CONFIG_INVALID`. Answers the object's access as it
 * stands. Needs `access.manage`.
 */
export async function setObjectAccess(
  scope: EngineScope,
  input: { readonly objectId: string; readonly subject: RuleSubject; readonly rule: ObjectAccessRule | null },
  hooks: readonly AfterWrite[] = [],
  options: AccessRuleOptions = {},
): Promise<ObjectAccess> {
  requirePermission(scope, 'access.manage');
  const objectId = checkId(input.objectId, OBJECT_NOT_FOUND);
  const { subject, rule } = input;
  if (subject.type === 'role' && !RuleRole.safeParse(subject.role).success) {
    throw refuse('CONFIG_INVALID', 'Rules are for members and teams. Owners and admins always see everything.');
  }
  if (rule !== null && (!isLevel(rule.level) || !isScope(rule.records))) {
    throw inputInvalid('rule', 'Pick no access, view or edit, and which records.');
  }
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
      // A subject with no access to the object has no records to scope; a team with none grants nothing.
      const level = rule?.level ?? 'none';
      const records: RecordScope = level === 'none' ? 'all' : (rule?.records ?? 'all');
      const owner = before.ownerAttribute;
      if (records !== 'all' && owner === undefined) {
        throw refuse('CONFIG_INVALID', 'This object has no Member field to share records by. Add one first.');
      }
      // A role at its default and a team with nothing are stored as no rule at all.
      const roleDefault = subject.type === 'role' ? ROLE_DEFAULT_LEVEL[subject.role] : undefined;
      const stores =
        rule !== null &&
        !(roleDefault !== undefined && level === roleDefault && records === 'all') &&
        !(teamId !== undefined && level === 'none');
      const subjectWhere = (table: typeof accessRules | typeof recordRules) =>
        subject.type === 'role' ? eq(table.subjectRole, subject.role) : eq(table.subjectTeamId, subject.teamId);
      const was = standing(before, subject);
      const next: SubjectAccess = {
        subject,
        level: stores ? level : (roleDefault ?? 'none'),
        records: stores ? records : 'all',
        defaultLevel: roleDefault ?? 'none',
        isDefault: !stores,
        people: was?.people ?? 0,
      };
      if (same(was, next) || (was === undefined && !stores)) return before;
      await tx
        .delete(accessRules)
        .where(
          and(
            eq(accessRules.workspaceId, scope.workspaceId),
            eq(accessRules.objectId, objectId),
            isNull(accessRules.attributeId),
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
      if (stores) {
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
        await tx.insert(accessRules).values({ workspaceId: scope.workspaceId, objectId, ...who, level, ...stamp });
        if (records !== 'all' && owner !== undefined) {
          await tx.insert(recordRules).values({
            workspaceId: scope.workspaceId,
            objectId,
            ...who,
            kind: records,
            attributeId: owner.id,
            ...stamp,
          });
        }
      }
      const [object] = await tx
        .select({ name: objects.pluralName })
        .from(objects)
        .where(and(eq(objects.workspaceId, scope.workspaceId), eq(objects.id, objectId)));
      const side = (standingOf: SubjectAccess | undefined) => ({
        level: standingOf?.level,
        records: standingOf?.records,
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
            ...side(next),
            isDefault: next.isDefault,
          },
        },
        options.source,
      );
      // Everyone the subject covers reads their access again, and the relay drops the workspace's audiences.
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
      context.record({ access: covered.map((row) => row.id) });
      return readAccess(tx, scope.workspaceId, objectId);
    },
    hooks,
  );
  return result;
}
