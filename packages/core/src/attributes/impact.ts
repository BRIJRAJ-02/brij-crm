// What changing or archiving an attribute would touch (flow pass, 30 October 2026), read when its settings open:
// the views, forms and rules that use it (the archive confirm names them in one line), how many records hold each
// option (an option's Archive asks where they go), how many records are empty (ticking Required) and how many
// values are shared (ticking Unique). One read, for schema managers only, through the access door: the counts are
// given only to someone who sees every record of the object (no record rule), as the unique refusal does
// (spec 0009, AC-144), and only when they finish within a short timeout; anyone else gets the uses alone.
// Writes nothing.
import { sql } from 'drizzle-orm';
import type { AttributeImpact } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import { objectLevel, recordRule } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { attributeVisible } from '../access/visibility.ts';
import { refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { UNIQUE_TYPES } from '../engine/unique.ts';
import { loadAttribute, type AttributeDef } from '../engine/values.ts';

/** The views using it: shared ones and the reader's own private ones, by name, with how each uses it. */
async function viewsUsing(
  tx: WorkspaceTx,
  attribute: AttributeDef,
  me: string | undefined,
): Promise<AttributeImpact['views']> {
  const rows = await tx.execute<{ id: string; name: string; grouped: boolean; filtered: boolean; sorted: boolean }>(sql`
    select v.id::text as id, v.name,
      coalesce(v.config->'board'->>'groupByAttributeId' = ${attribute.id}
        or v.config->>'groupBy' = ${attribute.id}, false) as grouped,
      coalesce(strpos((v.config->'filter')::text, ${attribute.id}) > 0, false) as filtered,
      coalesce(strpos((v.config->'sorts')::text, ${attribute.id}) > 0, false) as sorted
    from views v
    where (v.object_id = ${attribute.objectId}
        or v.list_id in (select l.id from lists l where l.object_id = ${attribute.objectId}))
      and (v.visibility::text <> 'private' or v.creator_member_id = ${me ?? null}::uuid)
    order by v.position, v.id
  `);
  return rows.rows.flatMap((row) => {
    const uses = [
      ...(row.grouped ? (['group'] as const) : []),
      ...(row.filtered ? (['filter'] as const) : []),
      ...(row.sorted ? (['sort'] as const) : []),
    ];
    return uses.length === 0 ? [] : [{ id: row.id, name: row.name, uses }];
  });
}

/** The forms whose draft or live version asks a question that files onto it, by name. */
async function formsUsing(tx: WorkspaceTx, attribute: AttributeDef): Promise<AttributeImpact['forms']> {
  const rows = await tx.execute<{ id: string; name: string }>(sql`
    select f.id::text as id, f.name
    from forms f
    where f.status <> 'archived'
      and exists (
        select 1 from form_versions fv
        where fv.workspace_id = f.workspace_id and fv.form_id = f.id
          and fv.id in (f.draft_version_id, f.live_version_id)
          and strpos(fv.document::text, ${attribute.id}) > 0
      )
    order by f.name, f.id
  `);
  return rows.rows;
}

/** How many of the object's other attributes' rules look at it in their "Only when…". */
async function rulesUsing(tx: WorkspaceTx, attribute: AttributeDef): Promise<number> {
  const rows = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from validation_rules r
    where r.object_id = ${attribute.objectId} and r.attribute_id <> ${attribute.id}
      and r.condition is not null and strpos(r.condition::text, ${attribute.id}) > 0
  `);
  return rows.rows[0]?.n ?? 0;
}

/** Live records of the object holding each option now, in one grouped count. */
async function optionCounts(tx: WorkspaceTx, attribute: AttributeDef): Promise<Readonly<Record<string, number>>> {
  const rows = await tx.execute<{ option_id: string; n: number }>(sql`
    select v.option_id::text as option_id, count(distinct v.record_id)::int as n
    from "values" v
    join records r on r.workspace_id = v.workspace_id and r.id = v.record_id and r.deleted_at is null
    where v.attribute_id = ${attribute.id} and v.active_until is null and not v.is_cleared
      and v.option_id is not null
    group by v.option_id
  `);
  return Object.fromEntries(rows.rows.map((row) => [row.option_id, row.n]));
}

/** Live records of the object with no value for it now. */
async function emptyCount(tx: WorkspaceTx, attribute: AttributeDef): Promise<number> {
  const rows = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from records r
    where r.object_id = ${attribute.objectId} and r.deleted_at is null
      and not exists (
        select 1 from "values" v
        where v.workspace_id = r.workspace_id and v.record_id = r.id and v.attribute_id = ${attribute.id}
          and v.active_until is null and not v.is_cleared
      )
  `);
  return rows.rows[0]?.n ?? 0;
}

/**
 * Values more than one live record shares, compared as Unique compares them (text ignoring case and spaces at the
 * ends, a number by its value); a link by its text as typed, so a link differing only in its host's case counts
 * apart here and is still refused by the save.
 */
async function duplicateCount(tx: WorkspaceTx, attribute: AttributeDef): Promise<number> {
  const key =
    attribute.type === 'number'
      ? sql`v.number_value::text`
      : attribute.type === 'text'
        ? sql`lower(btrim(v.text_value))`
        : sql`v.text_value`;
  const rows = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from (
      select ${key} as k
      from "values" v
      join records r on r.workspace_id = v.workspace_id and r.id = v.record_id and r.deleted_at is null
      where v.attribute_id = ${attribute.id} and v.active_until is null and not v.is_cleared
      group by 1
      having ${key} is not null and count(distinct v.record_id) > 1
    ) shared
  `);
  return rows.rows[0]?.n ?? 0;
}

/**
 * What an attribute's settings show before a change (flow pass, 30 October 2026). Refuses `FORBIDDEN` without
 * `schema.manage` and `NOT_FOUND` for an attribute the reader can't see or one on a list.
 */
export async function attributeImpact(
  scope: EngineScope,
  input: { readonly attributeId: string },
): Promise<AttributeImpact> {
  requirePermission(scope, 'schema.manage');
  const uses = await inWorkspace(scope, async (tx) => {
    const attribute = await loadAttribute(tx, input.attributeId);
    const objectId = attribute.objectId;
    if (
      objectId === null ||
      !attributeVisible(scope.access, attribute) ||
      objectLevel(scope.access, objectId) === 'none'
    ) {
      throw refuse('NOT_FOUND', 'That attribute does not exist.', attribute.id);
    }
    const me = scope.actor.type === 'member' && scope.actor.id !== null ? scope.actor.id : undefined;
    return {
      attribute,
      objectId,
      found: {
        views: await viewsUsing(tx, attribute, me),
        forms: await formsUsing(tx, attribute),
        rules: await rulesUsing(tx, attribute),
      },
    };
  });
  const { attribute, objectId, found } = uses;
  // Counts only for someone who sees every record: a count over records they can't read would say something.
  if (recordRule(scope.access, objectId) !== undefined || attribute.isSystem) return found;
  const takesOptions = attribute.type === 'select' || attribute.type === 'status';
  // The counts read every record of the object: held to a short timeout in a transaction of their own, and left out
  // when they run over (a very large object), so opening settings never holds a pooled connection long.
  try {
    const counts = await inWorkspace(scope, async (tx) => {
      await tx.execute(sql`select set_config('statement_timeout', ${COUNTS_TIMEOUT}, true)`);
      return {
        emptyCount: await emptyCount(tx, attribute),
        ...(takesOptions ? { optionCounts: await optionCounts(tx, attribute) } : {}),
        ...(UNIQUE_TYPES.includes(attribute.type) ? { duplicateCount: await duplicateCount(tx, attribute) } : {}),
      };
    });
    return { ...found, ...counts };
  } catch (error) {
    if (isStatementTimeout(error)) return found;
    throw error;
  }
}

/** How long the counts may take, all three together. */
const COUNTS_TIMEOUT = '1500ms';

/** Postgres's query_canceled (57014), as a statement timeout raises it, wherever the driver wraps it. */
function isStatementTimeout(error: unknown): boolean {
  for (let at: unknown = error; typeof at === 'object' && at !== null; at = (at as { cause?: unknown }).cause) {
    if ((at as { code?: unknown }).code === '57014') return true;
  }
  return false;
}
