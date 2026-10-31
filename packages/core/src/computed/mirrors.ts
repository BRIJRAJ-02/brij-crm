// Mirrored options (spec 0015, AC-314): a value's option must be one of its own
// attribute's (spec 0004's foreign key), so a lookup of a select or status keeps
// a mirror of each of the related attribute's options, archived ones included.
// Every option write on an attribute that is looked up brings its mirrors in
// line in the same save, so a rename, recolour, reorder or archive shows on the
// lookup at once, with no recompute.
import { sql } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';
import { refuse } from '../engine/refusals.ts';
import { recordDefinition } from '../engine/definitions.ts';
import { actorRow } from '../engine/scope.ts';
import { computedKindOf, type AttributeDef } from '../engine/values.ts';
import type { WriteContext } from '../engine/write.ts';
import { startFill } from './jobs.ts';

/**
 * Brings the mirrors of `originalId`'s options in line on every lookup of it (or on `lookupId` alone): each mirror
 * takes its original's label, hue, place, stage settings and archived state, and an original with no mirror gets
 * one. Records a definitions change for each lookup's object.
 */
export async function syncMirrors(context: WriteContext, originalId: string, lookupId?: string): Promise<void> {
  const { tx, scope } = context;
  const lookups = await tx.execute<{ id: string; object_id: string; type: string }>(sql`
    select distinct c.id::text as id, c.object_id::text as object_id, c.type::text as type
    from computed_inputs ci
    join attributes c on c.workspace_id = ci.workspace_id and c.id = ci.computed_attribute_id
    where ci.input_attribute_id = ${originalId} and ci.role = 'far_value' and c.computed->>'kind' = 'lookup'
      and c.type in ('select', 'status')
      ${lookupId === undefined ? sql`` : sql`and c.id = ${lookupId}`}
  `);
  if (lookups.rows.length === 0) return;
  const ids = lookups.rows.map((row) => row.id);
  const idList = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  // Archived ones first, so a label freed by an archive is free before another takes it.
  await tx.execute(sql`
    update attribute_options m set
      label = o.label, hue = o.hue, position = o.position,
      outcome = case when c.type = 'status' then o.outcome end,
      target_time_in_stage = case when c.type = 'status' then o.target_time_in_stage end,
      archived_at = o.archived_at, updated_at = now()
    from attribute_options o, attributes c
    where m.mirror_of = o.id and o.attribute_id = ${originalId} and c.id = m.attribute_id and m.attribute_id in (${idList})
      and (m.label, m.hue, m.position, m.archived_at is null, m.outcome, m.target_time_in_stage)
        is distinct from (o.label, o.hue, o.position, o.archived_at is null,
          case when c.type = 'status' then o.outcome end, case when c.type = 'status' then o.target_time_in_stage end)
  `);
  const by = actorRow(scope.actor);
  await tx.execute(sql`
    insert into attribute_options (
      workspace_id, attribute_id, label, hue, position, outcome, target_time_in_stage, archived_at, mirror_of,
      created_by_type, created_by_id, created_by_member_id, updated_by_type, updated_by_id, updated_by_member_id
    )
    select ${scope.workspaceId}::uuid, c.id, o.label, o.hue, o.position,
      case when c.type = 'status' then o.outcome end, case when c.type = 'status' then o.target_time_in_stage end,
      o.archived_at, o.id, ${by.type}, ${by.id}, ${by.memberId}, ${by.type}, ${by.id}, ${by.memberId}
    from attribute_options o cross join attributes c
    where o.attribute_id = ${originalId} and c.id in (${idList})
      and not exists (select 1 from attribute_options m where m.attribute_id = c.id and m.mirror_of = o.id)
  `);
  for (const row of lookups.rows) recordDefinition(context, { id: row.id, objectId: row.object_id, listId: null });
}

/** Archives a lookup's mirrors (its target changed): values that hold them keep them, marked archived. */
export async function archiveMirrors(tx: WorkspaceTx, lookupId: string): Promise<void> {
  await tx.execute(sql`
    update attribute_options set archived_at = coalesce(archived_at, now()), updated_at = now()
    where attribute_id = ${lookupId} and mirror_of is not null
  `);
}

/** Refuses an option write on a lookup's mirrored options (spec 0015): they follow the attribute it looks up. */
export function refuseMirrorWrite(attribute: AttributeDef): void {
  if (computedKindOf(attribute) === undefined) return;
  throw refuse('ATTRIBUTE_READ_ONLY', `${attribute.title}'s options follow the attribute it looks up.`, attribute.id);
}

/**
 * After an option write on `attributeId`: its lookups' mirrors follow in the same save, and when a label changed,
 * the formulas reading its options by label are worked out again (their `option_labels` input).
 */
export async function afterOptionChange(context: WriteContext, attributeId: string, labelChanged: boolean) {
  await syncMirrors(context, attributeId);
  if (!labelChanged) return;
  const formulas = await context.tx.execute<{ id: string }>(sql`
    select distinct ci.computed_attribute_id::text as id from computed_inputs ci
    join attributes c on c.workspace_id = ci.workspace_id and c.id = ci.computed_attribute_id
    where ci.input_attribute_id = ${attributeId} and ci.role = 'option_labels'
      and c.archived_at is null and c.computed_state <> 'broken'
  `);
  for (const row of formulas.rows) await startFill(context, row.id);
}
