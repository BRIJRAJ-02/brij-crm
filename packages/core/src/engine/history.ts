// Reading the past (spec 0004, AC-3): every version of an attribute, a
// record's values as of any moment, and every visit to each status stage.
// A version covers `active_from` up to but not including `active_until`.
import { and, asc, eq, lte, or, gt, isNull, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import type { ValueVersion } from '@crm/contracts/values';
import { decodeValue, type StoredItem } from './columns.ts';
import { refuse } from './refusals.ts';
import type { Actor, EngineScope } from './scope.ts';
import { ITEM_COLUMNS, loadAttribute, loadAttributes } from './values.ts';

const { records, values } = schema;

const ISO = (column: unknown) => sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

async function ownerExists(tx: WorkspaceTx, recordId: string): Promise<{ objectId: string; createdAt: Date }> {
  const [row] = await tx
    .select({ objectId: records.objectId, createdAt: records.createdAt })
    .from(records)
    .where(eq(records.id, recordId));
  if (row === undefined) throw refuse('NOT_FOUND', 'That record does not exist.');
  return row;
}

/** Every version of one attribute on one record, oldest first; a cleared version's value is null. */
export async function getHistory(
  scope: EngineScope,
  input: { readonly recordId: string; readonly attributeId: string },
): Promise<readonly ValueVersion[]> {
  return scope.db.withWorkspace(scope.workspaceId, async (tx) => {
    await ownerExists(tx, input.recordId);
    const attribute = await loadAttribute(tx, input.attributeId);
    const rows = await tx
      .select({
        ...ITEM_COLUMNS,
        versionId: values.versionId,
        isCleared: values.isCleared,
        activeFrom: ISO(values.activeFrom),
        activeUntil: sql<
          string | null
        >`to_char(${values.activeUntil} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
        setByType: values.setByType,
        setById: values.setById,
      })
      .from(values)
      .where(and(eq(values.ownerId, input.recordId), eq(values.attributeId, input.attributeId)))
      .orderBy(asc(values.activeFrom), asc(values.position));
    const versions = new Map<string, typeof rows>();
    for (const row of rows) versions.set(row.versionId, [...(versions.get(row.versionId) ?? []), row]);
    return [...versions.values()].flatMap((items) => {
      const [first] = items;
      if (first === undefined) return [];
      const held = items.filter((item) => !item.isCleared);
      const setBy: Actor = { type: first.setByType, id: first.setById };
      return [
        {
          value: decodeValue(attribute.type, attribute.isMulti, held),
          activeFrom: first.activeFrom,
          activeUntil: first.activeUntil,
          setBy,
        },
      ];
    });
  });
}

/** A record's values as they stood at `at` (an ISO timestamp), by attribute id. Empty before the record existed. */
export async function getValuesAsOf(
  scope: EngineScope,
  input: { readonly recordId: string; readonly at: string },
): Promise<Readonly<Record<string, unknown>>> {
  if (Number.isNaN(Date.parse(input.at))) throw refuse('CONFIG_INVALID', 'Give the moment as an ISO timestamp.');
  return scope.db.withWorkspace(scope.workspaceId, async (tx) => {
    const record = await ownerExists(tx, input.recordId);
    if (record.createdAt.getTime() > Date.parse(input.at)) return {};
    const attributes = await loadAttributes(tx, record.objectId);
    const at = sql`${input.at}::timestamptz`;
    const rows = await tx
      .select({ ...ITEM_COLUMNS, attributeId: values.attributeId, isCleared: values.isCleared })
      .from(values)
      .where(
        and(
          eq(values.ownerId, input.recordId),
          lte(values.activeFrom, at),
          or(isNull(values.activeUntil), gt(values.activeUntil, at)),
        ),
      );
    const result: Record<string, unknown> = {};
    for (const attribute of attributes.values()) {
      if (attribute.isSystem) continue;
      const mine: StoredItem[] = rows.filter((row) => row.attributeId === attribute.id && !row.isCleared);
      result[attribute.id] = decodeValue(attribute.type, attribute.isMulti, mine);
    }
    return result;
  });
}

/** One stay in a stage: when the record entered it, and when it left (null while it's still there). */
export interface StageVisit {
  readonly enteredAt: string;
  readonly leftAt: string | null;
}

/** Every visit a record made to each stage of a status attribute, with the total time per stage in milliseconds. */
export async function getTimeInStages(
  scope: EngineScope,
  input: { readonly recordId: string; readonly attributeId: string },
): Promise<readonly { readonly optionId: string; readonly visits: readonly StageVisit[]; readonly totalMs: number }[]> {
  return scope.db.withWorkspace(scope.workspaceId, async (tx) => {
    await ownerExists(tx, input.recordId);
    const attribute = await loadAttribute(tx, input.attributeId);
    if (attribute.type !== 'status')
      throw refuse('CONFIG_INVALID', 'Time in stage is for status attributes.', input.attributeId);
    const rows = await tx.execute<{ option_id: string; entered: string; left: string | null; ms: string }>(sql`
      select option_id::text,
        to_char(active_from at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as entered,
        to_char(active_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as left,
        (extract(epoch from (coalesce(active_until, clock_timestamp()) - active_from)) * 1000)::bigint::text as ms
      from "values"
      where owner_id = ${input.recordId} and attribute_id = ${input.attributeId} and option_id is not null
      order by active_from
    `);
    const byOption = new Map<string, { visits: StageVisit[]; totalMs: number }>();
    for (const row of rows.rows) {
      const entry = byOption.get(row.option_id) ?? { visits: [], totalMs: 0 };
      entry.visits.push({ enteredAt: row.entered, leftAt: row.left });
      entry.totalMs += Number(row.ms);
      byOption.set(row.option_id, entry);
    }
    return [...byOption].map(([optionId, entry]) => ({ optionId, ...entry }));
  });
}
