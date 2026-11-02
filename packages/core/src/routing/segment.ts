// The segment a booking's learning counts in (spec 0037, AC-1370), read at
// the booking before any lock.
//
// A segment is the lead's values for at most two **segment attributes**, each
// a live select or status field of Companies or Deals with at most six
// options — never People, so nothing about a person is ever learned from. A
// lead's value is the answer of a question that files to that field, else the
// field's value on their company or their latest open deal, resolved exactly
// as fit resolves one (`fit.ts`). A value missing for any of them makes the
// `?` segment, which is never warm and always falls back to the page's all
// segments cell.
//
// A workspace with no segment attributes reads nothing at all: the key is
// `*`, its one cell.
import { ALL_SEGMENTS, segmentKeyOf, UNKNOWN_SEGMENT } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { answeredOptions, fieldsOf } from './fit.ts';
import { recordFacts, type RecordFactObjects } from './facts.ts';

/** What reading a segment key needs: the attributes, the lead and the answers the rules already read. */
export interface SegmentInput {
  readonly attributeIds: readonly string[];
  readonly objects: RecordFactObjects;
  /** The email the visitor typed, unchecked (`facts.ts`); empty means no record is matched. */
  readonly email: string;
  readonly answers: Readonly<Record<string, unknown>>;
  /** Which attribute each answered question files to, by question key. */
  readonly filedOn: ReadonlyMap<string, string>;
}

/**
 * The booking's canonical segment key (AC-1370). A field that isn't live on
 * Companies or Deals any more drops the lead into `?` rather than inventing a
 * value, so an archived segment attribute never quietly changes the cells.
 */
export async function readSegmentKey(tx: WorkspaceTx, input: SegmentInput): Promise<string> {
  const attributeIds = [...input.attributeIds];
  if (attributeIds.length === 0) return ALL_SEGMENTS;
  const fields = await fieldsOf(tx, attributeIds);
  // A segment never reads People: a person's own field would make the cell about an individual (AC-1370).
  const usable = new Map([...fields].filter(([, field]) => field.side !== 'person'));
  if (usable.size !== attributeIds.length) return UNKNOWN_SEGMENT;

  const answered = new Map<string, string>();
  for (const [key, attributeId] of input.filedOn) {
    const field = usable.get(attributeId);
    if (field === undefined || !Object.hasOwn(input.answers, key)) continue;
    const [first] = answeredOptions(input.answers[key], field.byId, field.byLabel);
    if (first !== undefined) answered.set(attributeId, first);
  }
  const fromRecords = attributeIds.filter((id) => !answered.has(id));
  if (fromRecords.length > 0 && input.email !== '') {
    const keys = fromRecords.map((id) => `${usable.get(id)?.side ?? 'company'}.${id}`);
    const read = await recordFacts(tx, input.objects, input.email, keys);
    for (const id of fromRecords) {
      const field = usable.get(id);
      if (field === undefined) continue;
      const [first] = answeredOptions(read.facts[`${field.side}.${id}`], field.byId, field.byLabel);
      if (first !== undefined) answered.set(id, first);
    }
  }
  return segmentKeyOf(attributeIds, (id) => answered.get(id));
}
