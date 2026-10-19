// Linking from the table (spec 0014, milestone 2): `links.add` and
// `links.remove` as the API serves them. Each runs one link delta, then reads
// the near record back fresh and names every other record the write changed
// (far records and moved links' old holders), so the browser reads those
// again.
import type { RecordView } from '@crm/contracts';
import type { RecordReferenceValue } from '@crm/contracts/values';
import { changeLinks, type LinksDelta } from '../engine/link-delta.ts';
import type { Actor, EngineScope } from '../engine/scope.ts';
import type { AfterWrite } from '../engine/write.ts';
import { freshRecord } from './records.ts';

/** What a link write answers: the near record fresh, the version it made, and the other records it changed. */
export interface LinksAnswer {
  readonly record: RecordView;
  /** The version this write made for the side, by attribute id; empty when it changed nothing. */
  readonly written: Readonly<Record<string, string>>;
  /** Every far record whose paired side changed, and each moved link's old holder; never the near record. */
  readonly changedRecordIds: readonly string[];
  /** A side that holds one, edited from an older version than it held: what this save replaced (AC-295). */
  readonly replaced?: { readonly versionId: string; readonly setBy: Actor };
}

/** Links to add on one side of one record. */
export interface AddLinksInput {
  readonly recordId: string;
  readonly attributeId: string;
  readonly targets: readonly RecordReferenceValue[];
  readonly move?: boolean;
  readonly baseVersionId?: string | null;
}

/** Links to remove from one side of one record, by far record id. */
export interface RemoveLinksInput {
  readonly recordId: string;
  readonly attributeId: string;
  readonly targetRecordIds: readonly string[];
}

async function answer(
  scope: EngineScope,
  recordId: string,
  delta: LinksDelta,
  hooks: readonly AfterWrite[],
): Promise<LinksAnswer> {
  const { objectId, attributes, changes } = await changeLinks(scope, delta, hooks);
  const [near, ...rest] = changes;
  const record = await freshRecord(scope, near?.ownerId ?? recordId, new Map([[objectId, attributes]]));
  const changedRecordIds = [...new Set(rest.map((change) => change.ownerId))].filter((id) => id !== record.id);
  return {
    record,
    written: near === undefined ? {} : { [near.attributeId]: near.versionId },
    changedRecordIds,
    ...(near?.replaced === undefined ? {} : { replaced: near.replaced }),
  };
}

/**
 * Adds links on one side of one record (spec 0014, AC-290 to AC-293): see
 * `writeLinksDelta`. A link already there changes nothing and answers the
 * record as it is. `RECORD_DELETED` from the read back means the write
 * committed and the record went to the trash meanwhile.
 */
export async function addRecordLinks(
  scope: EngineScope,
  input: AddLinksInput,
  hooks: readonly AfterWrite[] = [],
): Promise<LinksAnswer> {
  return answer(
    scope,
    input.recordId,
    {
      kind: 'add',
      recordId: input.recordId,
      attributeId: input.attributeId,
      targets: input.targets,
      ...(input.move === undefined ? {} : { move: input.move }),
      ...(input.baseVersionId === undefined ? {} : { baseVersionId: input.baseVersionId }),
    },
    hooks,
  );
}

/** Removes links from one side of one record (spec 0014, AC-290, AC-291); a link not there changes nothing. */
export async function removeRecordLinks(
  scope: EngineScope,
  input: RemoveLinksInput,
  hooks: readonly AfterWrite[] = [],
): Promise<LinksAnswer> {
  return answer(
    scope,
    input.recordId,
    {
      kind: 'remove',
      recordId: input.recordId,
      attributeId: input.attributeId,
      targetRecordIds: input.targetRecordIds,
    },
    hooks,
  );
}
