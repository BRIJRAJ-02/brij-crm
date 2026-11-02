// The segment attributes in words (spec 0037, AC-1370, AC-1376): their names
// and their options' labels, so Insights can say "Segment is Enterprise"
// rather than print a key of ids, and can tell when the attributes changed
// since the last run.
import { sql } from 'drizzle-orm';
import { ALL_SEGMENTS, UNKNOWN_SEGMENT } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { uuidArray } from '../engine/ids.ts';

/** The segment attributes as Insights reads them. */
export interface SegmentNames {
  /** Each attribute now set, by id and name, in the order the key uses. */
  readonly attributes: { readonly id: string; readonly name: string }[];
  /** Every option label of those attributes, by option id. */
  readonly options: ReadonlyMap<string, string>;
  /**
   * Whether the stats were trained under different attributes (AC-1370): true
   * when any trained segment key names a field that isn't a segment attribute
   * now, so segment learning restarts while the all segments cells carry on.
   */
  readonly restarted: (segmentKeys: readonly string[]) => boolean;
}

/** The segment attributes' names and option labels; an archived one is simply absent, and so reads as changed. */
export async function readSegmentNames(tx: WorkspaceTx, attributeIds: readonly string[]): Promise<SegmentNames> {
  const set = new Set(attributeIds);
  const restarted = (segmentKeys: readonly string[]) =>
    segmentKeys.some((key) => {
      if (key === ALL_SEGMENTS || key === UNKNOWN_SEGMENT) return false;
      return key.split(';').some((part) => !set.has(part.split('=')[0] ?? ''));
    });
  if (attributeIds.length === 0) return { attributes: [], options: new Map(), restarted };
  const ids = uuidArray([...attributeIds]);
  const fields = await tx.execute<{ id: string; name: string }>(
    sql`select id::text, title as name from attributes where id = any(${ids}) and archived_at is null`,
  );
  const options = await tx.execute<{ id: string; label: string }>(
    sql`select id::text, label from attribute_options where attribute_id = any(${ids}) and archived_at is null`,
  );
  const byId = new Map(fields.rows.map((row) => [row.id, row.name]));
  return {
    // In the order the key uses, which is the order they were set in.
    attributes: attributeIds.flatMap((id) => {
      const name = byId.get(id);
      return name === undefined ? [] : [{ id, name }];
    }),
    options: new Map(options.rows.map((row) => [row.id, row.label])),
    restarted,
  };
}
