// Routing › Skills (spec 0037, AC-1382): up to 100 skills a workspace, each in a group (Language, Region, Segment,
// Product, Other), named 1 to 40 characters, unique in its group ignoring case; members hold any of them. Any member
// lists them (a team page's editor picks them in a host route, AC-1356); every write needs `routing.manage`. A skill
// a host route names (a team page's rules, or a form's live or draft rules) can't be deleted: 409 `SKILL_IN_USE`,
// naming where. Each write is one `routing.skills_changed` audit row with before and after. Skills are settings, as
// rotations and editors are: no outbox row; screens read them again.
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  SKILL_GROUPS,
  SKILLS_MAX,
  type CreateSkillInput,
  type DeleteSkillInput,
  type MemberSkills,
  type RoutingSkill,
  type SetMemberSkillsInput,
  type SkillGroup,
  type SkillsView,
  type UpdateSkillInput,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { postgresError, refuse, refuseOn } from '../engine/refusals.ts';
import { actorRow } from '../engine/scope.ts';
import { writeAudit } from '../members/audit.ts';
import type { RemovalEffect } from '../members/removal-effect.ts';

const { memberSkills, members, routingSettings, routingSkills } = schema;

const LIMIT_MESSAGE = `A workspace can have at most ${String(SKILLS_MAX)} skills.`;
const SKILL_MISSING = 'That skill doesn’t exist any more.';
const NAME_TAKEN = 'That group already has a skill with this name.';
const NOT_A_TEAMMATE = 'Pick an active teammate.';

const groupOrder = (group: string) => SKILL_GROUPS.indexOf(group as SkillGroup);

/** Reads a stored group, failing closed to Other for a value this version doesn't know. */
const groupOf = (stored: string): SkillGroup =>
  (SKILL_GROUPS as readonly string[]).includes(stored) ? (stored as SkillGroup) : 'other';

/** Every skill in Skills' order (group, then place, then name), every active member's skills, and Won means set. */
export async function readSkills(tx: WorkspaceTx): Promise<SkillsView> {
  const rows = await tx
    .select({
      id: routingSkills.id,
      group: routingSkills.skillGroup,
      name: routingSkills.name,
      position: routingSkills.position,
    })
    .from(routingSkills)
    .orderBy(asc(routingSkills.position), asc(routingSkills.name), asc(routingSkills.id));
  const skills: RoutingSkill[] = rows
    .map((row) => ({ id: row.id, group: groupOf(row.group), name: row.name, position: row.position }))
    .sort((a, b) => groupOrder(a.group) - groupOrder(b.group));
  const held = await tx
    .select({ memberId: memberSkills.memberId, skillId: memberSkills.skillId })
    .from(memberSkills)
    .innerJoin(members, and(eq(members.workspaceId, memberSkills.workspaceId), eq(members.id, memberSkills.memberId)))
    .where(eq(members.status, 'active'))
    .orderBy(asc(memberSkills.memberId));
  const byMember = new Map<string, string[]>();
  for (const row of held) byMember.set(row.memberId, [...(byMember.get(row.memberId) ?? []), row.skillId]);
  const order = new Map(skills.map((skill, index) => [skill.id, index]));
  const membersView: MemberSkills[] = [...byMember].map(([memberId, skillIds]) => ({
    memberId,
    skillIds: [...skillIds].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
  }));
  const [settings] = await tx.select({ wonStage: routingSettings.wonStage }).from(routingSettings);
  return { skills, members: membersView, wonMeansSet: settings !== undefined && settings.wonStage !== null };
}

/** The workspace's skills and who holds them (AC-1382): for any member. */
export async function listSkills(scope: EngineScope): Promise<SkillsView> {
  return inWorkspace(scope, readSkills);
}

/** The audit row's view of a skill. */
const shown = (skill: { readonly id: string; readonly group: string; readonly name: string }) => ({
  id: skill.id,
  group: skill.group,
  name: skill.name,
});

/** One skill, locked for the write, or NOT_FOUND. */
async function skillFor(tx: WorkspaceTx, id: string) {
  const [row] = await tx
    .select({ id: routingSkills.id, group: routingSkills.skillGroup, name: routingSkills.name })
    .from(routingSkills)
    .where(eq(routingSkills.id, id))
    .for('update');
  if (row === undefined) throw refuse('NOT_FOUND', SKILL_MISSING);
  return row;
}

/** A name another skill of the group holds is `CONFIG_INVALID` on `name`, from the unique index. */
function nameTaken(error: unknown): never {
  const found = postgresError(error);
  if (found?.code === '23505' && found.constraint === 'routing_skills_name') {
    throw refuseOn('CONFIG_INVALID', NAME_TAKEN, 'name');
  }
  throw error;
}

/**
 * Adds a skill at the end of its group (AC-1382), under the id the screen minted (a retry with the same id answers
 * the list). At most 100: `SKILL_LIMIT`. Counted under the workspace's skills lock, so two at once never make 101.
 */
export async function createSkill(
  scope: EngineScope,
  input: Pick<CreateSkillInput, 'id' | 'group' | 'name'>,
): Promise<SkillsView> {
  requirePermission(scope, 'routing.manage');
  return inWorkspace(scope, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`routing_skills:${scope.workspaceId}`}, 0))`);
    const [again] = await tx.select({ id: routingSkills.id }).from(routingSkills).where(eq(routingSkills.id, input.id));
    if (again !== undefined) return readSkills(tx);
    const [counted] = await tx
      .select({
        count: sql<number>`count(*)::int`,
        last: sql<number>`coalesce(max(${routingSkills.position}), -1)::int`,
      })
      .from(routingSkills);
    if ((counted?.count ?? 0) >= SKILLS_MAX) throw refuse('SKILL_LIMIT', LIMIT_MESSAGE);
    const by = actorRow(scope.actor);
    await tx
      .insert(routingSkills)
      .values({
        workspaceId: scope.workspaceId,
        id: input.id,
        skillGroup: input.group,
        name: input.name,
        position: (counted?.last ?? -1) + 1,
        createdByType: by.type,
        createdById: by.id,
        createdByMemberId: by.memberId,
        updatedByType: by.type,
        updatedById: by.id,
        updatedByMemberId: by.memberId,
      })
      .catch(nameTaken);
    await writeAudit(tx, scope.workspaceId, scope.actor, {
      action: 'routing.skills_changed',
      targetType: 'workspace',
      targetId: scope.workspaceId,
      after: { skill: shown({ id: input.id, group: input.group, name: input.name }) },
    });
    return readSkills(tx);
  });
}

/** Renames a skill or moves it to another group (AC-1382); a move puts it at the end. */
export async function updateSkill(
  scope: EngineScope,
  input: Pick<UpdateSkillInput, 'id' | 'group' | 'name'>,
): Promise<SkillsView> {
  requirePermission(scope, 'routing.manage');
  return inWorkspace(scope, async (tx) => {
    const before = await skillFor(tx, input.id);
    const group = input.group ?? before.group;
    const name = input.name ?? before.name;
    if (group === before.group && name === before.name) return readSkills(tx);
    const by = actorRow(scope.actor);
    await tx
      .update(routingSkills)
      .set({
        skillGroup: group,
        name,
        updatedAt: sql`now()`,
        updatedByType: by.type,
        updatedById: by.id,
        updatedByMemberId: by.memberId,
      })
      .where(eq(routingSkills.id, before.id))
      .catch(nameTaken);
    await writeAudit(tx, scope.workspaceId, scope.actor, {
      action: 'routing.skills_changed',
      targetType: 'workspace',
      targetId: scope.workspaceId,
      before: { skill: shown(before) },
      after: { skill: shown({ id: before.id, group, name }) },
    });
    return readSkills(tx);
  });
}

interface UsingRow extends Record<string, unknown> {
  readonly kind: 'page' | 'form';
  readonly name: string;
  readonly rules: unknown;
}

/** The place (1 based) of the first rule in `rules` whose hosts require `skillId`, if any. */
function ruleUsing(rules: unknown, skillId: string): number | undefined {
  if (!Array.isArray(rules)) return undefined;
  const at = rules.findIndex((rule: unknown) => {
    if (typeof rule !== 'object' || rule === null) return false;
    const then = (rule as { then?: { hosts?: unknown } }).then;
    const hosts = then?.hosts;
    if (typeof hosts !== 'object' || hosts === null || Array.isArray(hosts)) return false;
    const ids = (hosts as { requireSkillIds?: unknown }).requireSkillIds;
    return Array.isArray(ids) && ids.includes(skillId);
  });
  return at === -1 ? undefined : at + 1;
}

/**
 * Where a skill is used (AC-1382): every live team page's rules, and every form's live and draft rules, whose host
 * routes require it, matched in the database by containment. "Rule 3 of Intro call", "Rule 1 of Contact us and 2
 * more". Undefined when nothing uses it.
 */
export async function skillUse(tx: WorkspaceTx, skillId: string): Promise<string | undefined> {
  const needle = JSON.stringify([{ then: { hosts: { requireSkillIds: [skillId] } } }]);
  const found = await tx.execute<UsingRow>(sql`
    select 'page' as kind, p.title as name, p.routing -> 'rules' as rules
    from booking_pages p
    where p.deleted_at is null and p.routing -> 'rules' @> ${needle}::jsonb
    union all
    select distinct on (f.id) 'form' as kind, f.name, v.document -> 'routing' -> 'rules' as rules
    from forms f
    join form_versions v on v.workspace_id = f.workspace_id and v.id in (f.live_version_id, f.draft_version_id)
    where f.status <> 'archived' and v.document -> 'routing' -> 'rules' @> ${needle}::jsonb
    order by name
    limit 20
  `);
  const places = found.rows.flatMap((row) => {
    const at = ruleUsing(row.rules, skillId);
    return at === undefined ? [] : [`Rule ${String(at)} of ${row.name}`];
  });
  const [first] = places;
  if (first === undefined) return undefined;
  return places.length === 1 ? first : `${first} and ${String(places.length - 1)} more`;
}

/**
 * Deletes a skill and every member's hold of it (AC-1382). Refused 409 `SKILL_IN_USE` while a host route requires
 * it: "Spanish is used by Rule 3 of Intro call. Change the rule first."
 */
export async function deleteSkill(scope: EngineScope, input: Pick<DeleteSkillInput, 'id'>): Promise<SkillsView> {
  requirePermission(scope, 'routing.manage');
  return inWorkspace(scope, async (tx) => {
    const [row] = await tx
      .select({ id: routingSkills.id, group: routingSkills.skillGroup, name: routingSkills.name })
      .from(routingSkills)
      .where(eq(routingSkills.id, input.id))
      .for('update');
    // Already gone: a retried delete answers the list.
    if (row === undefined) return readSkills(tx);
    const where = await skillUse(tx, row.id);
    if (where !== undefined) throw refuse('SKILL_IN_USE', `${row.name} is used by ${where}. Change the rule first.`);
    const held = await tx
      .select({ memberId: memberSkills.memberId })
      .from(memberSkills)
      .where(eq(memberSkills.skillId, row.id));
    await tx.delete(routingSkills).where(eq(routingSkills.id, row.id));
    await writeAudit(tx, scope.workspaceId, scope.actor, {
      action: 'routing.skills_changed',
      targetType: 'workspace',
      targetId: scope.workspaceId,
      before: { skill: shown(row), heldBy: held.length },
    });
    return readSkills(tx);
  });
}

/**
 * Replaces one member's skills (AC-1382): an active member (CONFIG_INVALID on `memberId` otherwise), each skill one
 * of the workspace's (CONFIG_INVALID on `skillIds`). Under the member's row lock; one audit row when it changed.
 */
export async function setMemberSkills(
  scope: EngineScope,
  input: Pick<SetMemberSkillsInput, 'memberId' | 'skillIds'>,
): Promise<SkillsView> {
  requirePermission(scope, 'routing.manage');
  const wanted = [...new Set(input.skillIds)];
  return inWorkspace(scope, async (tx) => {
    const [member] = await tx
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.id, input.memberId), eq(members.status, 'active')))
      .for('no key update');
    if (member === undefined) throw refuseOn('CONFIG_INVALID', NOT_A_TEAMMATE, 'memberId');
    if (wanted.length > 0) {
      const known = await tx
        .select({ id: routingSkills.id })
        .from(routingSkills)
        .where(inArray(routingSkills.id, wanted));
      if (known.length !== wanted.length) throw refuseOn('CONFIG_INVALID', SKILL_MISSING, 'skillIds');
    }
    const before = (
      await tx.select({ skillId: memberSkills.skillId }).from(memberSkills).where(eq(memberSkills.memberId, member.id))
    ).map((row) => row.skillId);
    const added = wanted.filter((id) => !before.includes(id));
    const removed = before.filter((id) => !wanted.includes(id));
    if (added.length === 0 && removed.length === 0) return readSkills(tx);
    if (removed.length > 0) {
      await tx
        .delete(memberSkills)
        .where(and(eq(memberSkills.memberId, member.id), inArray(memberSkills.skillId, removed)));
    }
    if (added.length > 0) {
      await tx
        .insert(memberSkills)
        .values(added.map((skillId) => ({ workspaceId: scope.workspaceId, memberId: member.id, skillId })));
    }
    await writeAudit(tx, scope.workspaceId, scope.actor, {
      action: 'routing.skills_changed',
      targetType: 'workspace',
      targetId: scope.workspaceId,
      before: { memberId: member.id, skillIds: before },
      after: { memberId: member.id, skillIds: wanted },
    });
    return readSkills(tx);
  });
}

/**
 * The members of `pool` holding every one of `skillIds` (AC-1356): who a route requiring skills narrows to. One
 * indexed read; an empty answer means the whole rotation picks.
 */
export async function membersWithSkills(
  tx: WorkspaceTx,
  pool: readonly string[],
  skillIds: readonly string[],
): Promise<readonly string[]> {
  if (pool.length === 0 || skillIds.length === 0) return [];
  const wanted = [...new Set(skillIds)];
  const rows = await tx
    .select({ memberId: memberSkills.memberId })
    .from(memberSkills)
    .where(and(inArray(memberSkills.skillId, wanted), inArray(memberSkills.memberId, [...new Set(pool)])))
    .groupBy(memberSkills.memberId)
    .having(sql`count(*) = ${wanted.length}`)
    .orderBy(asc(memberSkills.memberId));
  return rows.map((row) => row.memberId);
}

/** A removed member holds no skill any more (spec 0037, AC-1440). */
export const skillsRemoval: RemovalEffect = {
  feature: 'member skills',
  constraints: ['member_skills_member'],
  run: async (context, memberId) => {
    await context.tx
      .delete(memberSkills)
      .where(and(eq(memberSkills.workspaceId, context.scope.workspaceId), eq(memberSkills.memberId, memberId)));
  },
};
