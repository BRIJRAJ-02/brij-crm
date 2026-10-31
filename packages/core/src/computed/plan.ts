// The planner (spec 0015, `planComputed`): `runWrite` calls it after every
// write's work, people's and jobs' alike, inside the transaction. It reads the
// dependency index once, for the attributes the change touched, and queues the
// records whose lookups and rollups now read something else: 1,000 or fewer as
// a `computed.recompute` job, more (or a change too wide to name them) as a
// whole `computed.fill`. Both are the system's jobs, started in the write's own
// transaction, so no committed change can be missed. A write with no values,
// references, creates or restores costs nothing.
import { sql } from 'drizzle-orm';
import { uuidArray } from '../engine/ids.ts';
import { loadAttribute } from '../engine/values.ts';
import type { RecordRef, ReferenceChange, ValueChange, WriteContext } from '../engine/write.ts';
import { startFill, startRecompute } from './jobs.ts';
import { loadVia, type ViaSide } from './statements.ts';

/** The most records one change recomputes by name; past it, the attribute's whole fill (spec 0015). */
export const RECOMPUTE_INLINE_MAX = 1_000;

/** What the planner reads of a write's change. */
export interface PlannedChange {
  readonly values: readonly ValueChange[];
  readonly references: readonly ReferenceChange[];
  readonly createdRecords: readonly RecordRef[];
  readonly restoredRecords: readonly RecordRef[];
  readonly coarseObjects: readonly string[];
}

/** One row of the planner's read: a computed attribute and how it reads one input the change touched. */
type InputRow = {
  readonly computed_id: string;
  readonly object_id: string;
  readonly kind: string;
  readonly role: 'link' | 'far_value' | 'far_condition' | 'own';
  readonly input_id: string | null;
  readonly via_id: string | null;
};

/** Where one computed attribute's recompute stands while the planner gathers it. */
interface Pending {
  readonly ids: Set<string>;
  fill: boolean;
}

/**
 * Queues the lookups and rollups (and, on a restore, the formulas) that read
 * what the change touched. Broken and archived computed attributes are left out.
 */
export async function planComputed(context: WriteContext, change: PlannedChange): Promise<void> {
  const recordValues = change.values.filter(
    (value): value is Extract<ValueChange, { ownerKind: 'record' }> => value.ownerKind === 'record',
  );
  const inputIds = [
    ...new Set([...recordValues.map((value) => value.attributeId), ...change.references.map((ref) => ref.attributeId)]),
  ];
  const ownObjects = [
    ...new Set([...change.createdRecords, ...change.restoredRecords].map((record) => record.objectId)),
  ];
  if (inputIds.length === 0 && ownObjects.length === 0) return;
  const { tx } = context;
  const found = await tx.execute<InputRow>(sql`
    select ci.computed_attribute_id::text as computed_id, c.object_id::text as object_id, c.computed->>'kind' as kind,
      ci.role::text as role, ci.input_attribute_id::text as input_id, ci.via_attribute_id::text as via_id
    from computed_inputs ci
    join attributes c on c.workspace_id = ci.workspace_id and c.id = ci.computed_attribute_id
    where ci.input_attribute_id = any(${uuidArray(inputIds)}) and ci.role in ('link', 'far_value', 'far_condition')
      and c.archived_at is null and c.computed_state <> 'broken'
    union all
    select c.id::text, c.object_id::text, c.computed->>'kind', 'own', null, null
    from attributes c
    where c.object_id = any(${uuidArray(ownObjects)}) and c.computed is not null
      and c.archived_at is null and c.computed_state <> 'broken'
  `);
  if (found.rows.length === 0) return;

  const pending = new Map<string, Pending>();
  const pendingOf = (id: string): Pending => {
    const known = pending.get(id);
    if (known !== undefined) return known;
    const made: Pending = { ids: new Set(), fill: false };
    pending.set(id, made);
    return made;
  };
  const add = (entry: Pending, ids: Iterable<string>) => {
    if (entry.fill) return;
    for (const id of ids) entry.ids.add(id);
    if (entry.ids.size > RECOMPUTE_INLINE_MAX) entry.fill = true;
  };
  const vias = new Map<string, ViaSide | undefined>();
  const viaOf = async (viaId: string, objectId: string): Promise<ViaSide | undefined> => {
    const key = `${viaId}:${objectId}`;
    if (vias.has(key)) return vias.get(key);
    const attribute = await loadAttribute(tx, viaId).catch(() => undefined);
    const via = attribute === undefined ? undefined : await loadVia(tx, attribute, objectId);
    vias.set(key, via);
    return via;
  };
  const coarse = new Set(change.coarseObjects);

  for (const row of found.rows) {
    const entry = pendingOf(row.computed_id);
    if (row.role === 'own') {
      // A new record's count is 0, not empty; a restored record's values were left as they were in the trash.
      const restored = change.restoredRecords.filter((record) => record.objectId === row.object_id);
      const created = change.createdRecords.filter((record) => record.objectId === row.object_id);
      const own = row.kind === 'formula' ? restored : [...restored, ...created];
      add(
        entry,
        own.map((record) => record.recordId),
      );
      continue;
    }
    if (row.role === 'link') {
      // The far object's references were cut short: the near records can't be named.
      if (coarse.has(row.object_id)) {
        entry.fill = true;
        continue;
      }
      add(entry, [
        ...recordValues.filter((value) => value.attributeId === row.input_id).map((value) => value.ownerId),
        ...change.references.filter((ref) => ref.attributeId === row.input_id).map((ref) => ref.recordId),
      ]);
      continue;
    }
    // A related record's value changed: the near records linked to it now, through the side followed.
    if (row.via_id === null || entry.fill) continue;
    const farIds = [
      ...new Set(recordValues.filter((value) => value.attributeId === row.input_id).map((value) => value.ownerId)),
    ];
    if (farIds.length === 0) continue;
    const via = await viaOf(row.via_id, row.object_id);
    if (via === undefined) continue;
    const near = via.isFrom ? sql.raw('from_record_id') : sql.raw('to_record_id');
    const far = via.isFrom ? sql.raw('to_record_id') : sql.raw('from_record_id');
    const linked = await tx.execute<{ id: string }>(sql`
      select distinct ${near}::text as id from record_links
      where relationship_id = ${via.relationshipId} and ${far} = any(${uuidArray(farIds)}) and active_until is null
      limit ${RECOMPUTE_INLINE_MAX + 1}
    `);
    add(
      entry,
      linked.rows.map((link) => link.id),
    );
  }

  for (const [attributeId, entry] of pending) {
    if (entry.fill) await startFill(context, attributeId);
    else if (entry.ids.size > 0) await startRecompute(context, attributeId, [...entry.ids]);
  }
}
