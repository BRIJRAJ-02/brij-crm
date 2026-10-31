// The production rule source (spec 0032, AC-841; spec 0031, AC-825): what the door reads about a member beyond their
// row, in the same transaction and in one statement. Their teams (and the active members of those teams, for a `team`
// record rule) and the stored object, field and record rules that name their role or one of their teams. Rows are
// read as text and handed to the policy as they are: a level or kind the code doesn't know is the policy's to fail
// closed on, not this file's to drop.
//
// `workspaceRules` is the relay's read of the same tables for every member at once (the audiences), so one live
// channel is shared by exactly the members whose policies are equal.
import { sql } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';
import type { RuleSource } from './door.ts';
import type { AccessRules, ComputedInputRule, LevelRule, RecordRuleRow, RuleSubject } from './policy.ts';

/** One row of the rule source's statement: a kind and its fields as text. */
type Row = {
  readonly k: string;
  readonly a: string | null;
  readonly b: string | null;
  readonly c: string | null;
  readonly d: string | null;
  readonly e: string | null;
};

/** The subject a stored row names: a role by its name, or a team by its id. */
const subjectOf = (type: string | null, who: string | null): RuleSubject | undefined => {
  if (who === null) return undefined;
  if (type === 'role') return { type: 'role', role: who };
  if (type === 'team') return { type: 'team', teamId: who };
  return undefined;
};

/** A stored object or field rule row (`a` the subject type, `b` who, `c` the object, `d` the attribute, `e` the level). */
function levelOf(row: Row): LevelRule | undefined {
  const subject = subjectOf(row.a, row.b);
  if (subject === undefined || row.c === null || row.e === null) return undefined;
  return {
    subject,
    target:
      row.d === null ? { type: 'object', objectId: row.c } : { type: 'attribute', objectId: row.c, attributeId: row.d },
    level: row.e,
  };
}

/** A stored record rule row (`e` the kind, `d` the attribute). */
function recordOf(row: Row): RecordRuleRow | undefined {
  const subject = subjectOf(row.a, row.b);
  if (subject === undefined || row.c === null || row.d === null || row.e === null) return undefined;
  return { subject, objectId: row.c, kind: row.e, attributeId: row.d };
}

/** A computed attribute's input row (`a` the computed attribute, `b` its object, `c` the input, `d` its object). */
function computedOf(row: Row): ComputedInputRule | undefined {
  if (row.a === null || row.b === null || row.c === null || row.d === null) return undefined;
  return {
    computedId: row.a,
    computedObjectId: row.b,
    inputId: row.c,
    inputObjectId: row.d,
    ...(row.e === null ? {} : { kind: row.e }),
  };
}

/**
 * The workspace's rules for one member, read in the door's own transaction (one statement, row level security
 * keeping every table to the workspace): their teams, the active members of those teams, and the rules that name
 * their role or any of those teams. A member in no team and a workspace with no rules cost the same one statement.
 */
export const storedRules: RuleSource = async (tx, member) => {
  const found = await tx.execute<Row>(sql`
    with workspace as (select nullif(current_setting('app.workspace_id', true), '')::uuid as id),
    mine as (
      select tm.team_id from team_members tm, workspace
      where tm.workspace_id = workspace.id and tm.member_id = ${member.memberId}::uuid
    )
    select 'team' as k, team_id::text as a, null::text as b, null::text as c, null::text as d, null::text as e from mine
    union all
    select 'mate', tm.member_id::text, null, null, null, null
      from team_members tm
      join members m on m.workspace_id = tm.workspace_id and m.id = tm.member_id and m.status = 'active'
      where tm.team_id in (select team_id from mine) and tm.workspace_id = (select id from workspace)
    union all
    select 'level', r.subject_type, coalesce(r.subject_role, r.subject_team_id::text), r.object_id::text,
        r.attribute_id::text, r.level
      from access_rules r
      where r.workspace_id = (select id from workspace)
        and (r.subject_role = ${member.role} or r.subject_team_id in (select team_id from mine))
    union all
    select 'record', r.subject_type, coalesce(r.subject_role, r.subject_team_id::text), r.object_id::text,
        r.attribute_id::text, r.kind
      from record_rules r
      where r.workspace_id = (select id from workspace)
        and (r.subject_role = ${member.role} or r.subject_team_id in (select team_id from mine))
    union all
    select 'computed', ci.computed_attribute_id::text, c.object_id::text, ci.input_attribute_id::text, i.object_id::text, c.computed->>'kind'
      from computed_inputs ci
      join attributes c on c.workspace_id = ci.workspace_id and c.id = ci.computed_attribute_id
      join attributes i on i.workspace_id = ci.workspace_id and i.id = ci.input_attribute_id
      where ci.workspace_id = (select id from workspace) and c.object_id is not null and i.object_id is not null
        and (exists (select 1 from access_rules r where r.workspace_id = (select id from workspace)
            and (r.subject_role = ${member.role} or r.subject_team_id in (select team_id from mine)))
          or exists (select 1 from record_rules r where r.workspace_id = (select id from workspace)
            and (r.subject_role = ${member.role} or r.subject_team_id in (select team_id from mine))))
  `);
  const levels: LevelRule[] = [];
  const records: RecordRuleRow[] = [];
  const computed: ComputedInputRule[] = [];
  const teamIds: string[] = [];
  const mates = new Set<string>([member.memberId]);
  for (const row of found.rows) {
    if (row.k === 'team' && row.a !== null) teamIds.push(row.a);
    else if (row.k === 'mate' && row.a !== null) mates.add(row.a);
    else if (row.k === 'level') {
      const level = levelOf(row);
      if (level !== undefined) levels.push(level);
    } else if (row.k === 'record') {
      const record = recordOf(row);
      if (record !== undefined) records.push(record);
    } else if (row.k === 'computed') {
      const input = computedOf(row);
      if (input !== undefined) computed.push(input);
    }
  }
  return { levels, records, computed, teamIds: teamIds.sort(), teamMemberIds: [...mates].sort() };
};

/** The whole workspace's rules and teams, for the relay's audiences. */
export interface WorkspaceRules {
  readonly levels: readonly LevelRule[];
  readonly records: readonly RecordRuleRow[];
  /** The rules and teams as one member sees them, ready for `roleAccess`. */
  readonly forMember: (memberId: string) => AccessRules;
  /** The ids of the teams a member is in, sorted: cheap, for work that only needs who shares which teams. */
  readonly teamIdsOf: (memberId: string) => readonly string[];
}

/**
 * Every stored rule and every team membership of the workspace, in one statement (the relay's system scope reads it
 * with the members): `forMember` then gives each member the rules and teams `storedRules` would have given them.
 */
export async function workspaceRules(tx: WorkspaceTx): Promise<WorkspaceRules> {
  const found = await tx.execute<Row>(sql`
    with workspace as (select nullif(current_setting('app.workspace_id', true), '')::uuid as id)
    select 'member' as k, tm.team_id::text as a, tm.member_id::text as b, null::text as c, null::text as d, null::text as e
      from team_members tm
      join members m on m.workspace_id = tm.workspace_id and m.id = tm.member_id and m.status = 'active'
      where tm.workspace_id = (select id from workspace)
    union all
    select 'level', r.subject_type, coalesce(r.subject_role, r.subject_team_id::text), r.object_id::text,
        r.attribute_id::text, r.level
      from access_rules r where r.workspace_id = (select id from workspace)
    union all
    select 'record', r.subject_type, coalesce(r.subject_role, r.subject_team_id::text), r.object_id::text,
        r.attribute_id::text, r.kind
      from record_rules r where r.workspace_id = (select id from workspace)
    union all
    select 'computed', ci.computed_attribute_id::text, c.object_id::text, ci.input_attribute_id::text, i.object_id::text, c.computed->>'kind'
      from computed_inputs ci
      join attributes c on c.workspace_id = ci.workspace_id and c.id = ci.computed_attribute_id
      join attributes i on i.workspace_id = ci.workspace_id and i.id = ci.input_attribute_id
      where ci.workspace_id = (select id from workspace) and c.object_id is not null and i.object_id is not null
        and (exists (select 1 from access_rules r where r.workspace_id = (select id from workspace))
          or exists (select 1 from record_rules r where r.workspace_id = (select id from workspace)))
  `);
  const levels: LevelRule[] = [];
  const records: RecordRuleRow[] = [];
  const computed: ComputedInputRule[] = [];
  const teamsOf = new Map<string, string[]>();
  const peopleOf = new Map<string, string[]>();
  for (const row of found.rows) {
    if (row.k === 'member' && row.a !== null && row.b !== null) {
      const joined = teamsOf.get(row.b);
      if (joined === undefined) teamsOf.set(row.b, [row.a]);
      else joined.push(row.a);
      const inTeam = peopleOf.get(row.a);
      if (inTeam === undefined) peopleOf.set(row.a, [row.b]);
      else inTeam.push(row.b);
    } else if (row.k === 'level') {
      const level = levelOf(row);
      if (level !== undefined) levels.push(level);
    } else if (row.k === 'record') {
      const record = recordOf(row);
      if (record !== undefined) records.push(record);
    } else if (row.k === 'computed') {
      const input = computedOf(row);
      if (input !== undefined) computed.push(input);
    }
  }
  return {
    levels,
    records,
    teamIdsOf: (memberId) => [...(teamsOf.get(memberId) ?? [])].sort(),
    forMember: (memberId) => {
      const teamIds = [...(teamsOf.get(memberId) ?? [])].sort();
      const mates = new Set<string>([memberId, ...teamIds.flatMap((teamId) => peopleOf.get(teamId) ?? [])]);
      return { levels, records, computed, teamIds, teamMemberIds: [...mates].sort() };
    },
  };
}
