// Creating records, setting their values and reading them back (spec 0004).
// Every write goes through runWrite and the value write protocol; every read
// runs inside withWorkspace().
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import { HUES, type EngineRefusal, type Hue, type RecordRefDisplay } from '@crm/contracts/values';
import { decodeValue } from './columns.ts';
import { isUuidV7 } from './ids.ts';
import { isRefusal, postgresError, refuse, refuseAll } from './refusals.ts';
import { actorRow, type Actor, type EngineScope } from './scope.ts';
import {
  currentItems,
  loadAttributes,
  lockRecord,
  parseFor,
  touchRecord,
  writeAttribute,
  type AttributeDef,
} from './values.ts';
import { runWrite, type AfterWrite, type ValueChange, type WriteContext } from './write.ts';

const { objects, records } = schema;

/** What a new record needs: its object, its values by attribute id, and optionally a client minted UUID v7. */
export interface RecordInput {
  readonly objectId: string;
  readonly values?: Readonly<Record<string, unknown>>;
  readonly id?: string;
}

/** One attribute's new value, and the version the edit started from. */
export interface ValueInput {
  readonly value: unknown;
  readonly baseVersionId?: string;
}

/** What one attribute's write did: its new version, or nothing when the value was unchanged. */
export interface AttributeResult {
  readonly versionId?: string;
  readonly replaced?: ValueChange['replaced'];
}

/** A record as screens and services read it. */
export interface RecordView {
  readonly id: string;
  readonly objectId: string;
  readonly createdAt: string;
  readonly createdBy: Actor;
  readonly updatedAt: string;
  readonly updatedBy: Actor;
  readonly display: RecordRefDisplay;
  /** Current values by attribute id, system attributes included, each in its schema's shape. */
  readonly values: Readonly<Record<string, unknown>>;
}

/** Parses every input against its attribute, collecting every refusal before anything is written (AC-13). */
function parseAll(
  attributes: ReadonlyMap<string, AttributeDef>,
  inputs: Readonly<Record<string, ValueInput>>,
): readonly { attribute: AttributeDef; input: ValueInput }[] {
  const refusals: EngineRefusal[] = [];
  const parsed: { attribute: AttributeDef; input: ValueInput }[] = [];
  for (const [attributeId, input] of Object.entries(inputs)) {
    const attribute = attributes.get(attributeId);
    if (attribute === undefined) {
      refusals.push({ code: 'NOT_FOUND', message: 'That attribute is not on this object.', attributeId });
      continue;
    }
    try {
      parseFor(attribute, input.value);
      parsed.push({ attribute, input });
    } catch (error) {
      if (!isRefusal(error)) throw error;
      refusals.push(...error.refusals);
    }
  }
  const [first, ...rest] = refusals;
  if (first !== undefined) throw refuseAll([first, ...rest]);
  return parsed;
}

/** Writes parsed inputs to one owner, returning each attribute's result. */
async function writeAll(
  context: WriteContext,
  ownerId: string,
  parsed: readonly { attribute: AttributeDef; input: ValueInput }[],
): Promise<Record<string, AttributeResult>> {
  const results: Record<string, AttributeResult> = {};
  const changes: ValueChange[] = [];
  for (const { attribute, input } of parsed) {
    const change = await writeAttribute(context, {
      ownerId,
      ownerKind: 'record',
      attribute,
      value: input.value,
      ...(input.baseVersionId === undefined ? {} : { baseVersionId: input.baseVersionId }),
    });
    if (change === undefined) {
      results[attribute.id] = {};
      continue;
    }
    changes.push(change);
    results[attribute.id] =
      change.replaced === undefined
        ? { versionId: change.versionId }
        : { versionId: change.versionId, replaced: change.replaced };
  }
  context.record({ values: changes });
  return results;
}

async function liveObject(tx: WorkspaceTx, objectId: string): Promise<void> {
  const [row] = await tx.select({ archivedAt: objects.archivedAt }).from(objects).where(eq(objects.id, objectId));
  if (row === undefined) throw refuse('NOT_FOUND', 'That object does not exist.');
  if (row.archivedAt !== null) throw refuse('NOT_FOUND', 'That object is archived. Restore it first.');
}

/** Creates a record with its first values (AC-1, AC-2, AC-13). */
export async function createRecord(scope: EngineScope, input: RecordInput, hooks: readonly AfterWrite[] = []) {
  if (input.id !== undefined && !isUuidV7(input.id)) {
    throw refuse('CONFIG_INVALID', 'A record id the client chooses must be a UUID v7.');
  }
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      await liveObject(tx, input.objectId);
      const attributes = await loadAttributes(tx, input.objectId);
      const inputs = Object.fromEntries(Object.entries(input.values ?? {}).map(([id, value]) => [id, { value }]));
      const parsed = parseAll(attributes, inputs);
      const by = actorRow(scope.actor);
      let recordId: string;
      try {
        const [row] = await tx
          .insert(records)
          .values({
            workspaceId: scope.workspaceId,
            ...(input.id === undefined ? {} : { id: input.id }),
            objectId: input.objectId,
            createdByType: by.type,
            createdById: by.id,
            createdByMemberId: by.memberId,
            updatedByType: by.type,
            updatedById: by.id,
            updatedByMemberId: by.memberId,
          })
          .returning({ id: records.id });
        if (row === undefined) throw new Error('The record was not created.');
        recordId = row.id;
      } catch (error) {
        if (postgresError(error)?.code === '23505') throw refuse('ID_TAKEN', 'A record with that id already exists.');
        throw error;
      }
      context.record({ createdRecords: [recordId] });
      const versions = await writeAll(context, recordId, parsed);
      return { recordId, versions };
    },
    hooks,
  );
  return result;
}

/** Sets values on a record, all or none (AC-3, AC-12, AC-13). */
export async function setValues(
  scope: EngineScope,
  input: { readonly recordId: string; readonly values: Readonly<Record<string, ValueInput>> },
  hooks: readonly AfterWrite[] = [],
): Promise<Record<string, AttributeResult>> {
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { objectId } = await lockRecord(context.tx, input.recordId);
      const attributes = await loadAttributes(context.tx, objectId);
      const parsed = parseAll(attributes, input.values);
      const results = await writeAll(context, input.recordId, parsed);
      if (Object.values(results).some((each) => each.versionId !== undefined)) {
        await touchRecord(context, input.recordId);
      }
      return results;
    },
    hooks,
  );
  return result;
}

function hueOf(value: string): Hue | undefined {
  return (HUES as readonly string[]).includes(value) ? (value as Hue) : undefined;
}

function nameOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'fullName' in value && typeof value.fullName === 'string') {
    return value.fullName;
  }
  return '';
}

/** Reads live records with their current values and display (AC-19). Up to 500 at once. */
export async function getRecords(
  scope: EngineScope,
  input: { readonly ids: readonly string[]; readonly attributeIds?: readonly string[] },
): Promise<readonly RecordView[]> {
  if (input.ids.length > 500) throw refuse('CONFIG_INVALID', 'Read at most 500 records at once.');
  if (input.ids.length === 0) return [];
  return scope.db.withWorkspace(scope.workspaceId, (tx) => readRecords(tx, input.ids, input.attributeIds));
}

/** Reads live records inside an open transaction, in the order of `ids`. */
export async function readRecords(
  tx: WorkspaceTx,
  ids: readonly string[],
  attributeIds?: readonly string[],
): Promise<readonly RecordView[]> {
  if (ids.length === 0) return [];
  const input = { ids, attributeIds };
  const rows = await tx
    .select()
    .from(records)
    .where(and(inArray(records.id, [...input.ids]), isNull(records.deletedAt)));
  const objectIds = [...new Set(rows.map((row) => row.objectId))];
  const objectRows =
    objectIds.length === 0 ? [] : await tx.select().from(objects).where(inArray(objects.id, objectIds));
  const objectById = new Map(objectRows.map((row) => [row.id, row]));
  const attributesByObject = new Map(
    await Promise.all(objectIds.map(async (id) => [id, await loadAttributes(tx, id)] as const)),
  );
  // The record's name needs its primary attribute, even when the caller asked for other attributes only.
  const primaryIds = objectRows.flatMap((row) => (row.primaryAttributeId === null ? [] : [row.primaryAttributeId]));
  const wanted = input.attributeIds === undefined ? undefined : [...input.attributeIds, ...primaryIds];
  const items = await currentItems(
    tx,
    rows.map((row) => row.id),
    wanted,
  );
  const order = new Map(input.ids.map((id, index) => [id, index]));

  return rows
    .map((row): RecordView => {
      const object = objectById.get(row.objectId);
      const attributes = attributesByObject.get(row.objectId) ?? new Map<string, AttributeDef>();
      const createdBy: Actor = { type: row.createdByType, id: row.createdById };
      const updatedBy: Actor = { type: row.updatedByType, id: row.updatedById };
      const system: Record<string, unknown> = {
        id: row.id,
        created_at: row.createdAt.toISOString(),
        created_by: createdBy,
        updated_at: row.updatedAt.toISOString(),
        updated_by: updatedBy,
      };
      const values: Record<string, unknown> = {};
      for (const attribute of attributes.values()) {
        if (input.attributeIds !== undefined && !input.attributeIds.includes(attribute.id)) continue;
        if (attribute.systemColumn !== null) {
          values[attribute.id] = system[attribute.systemColumn];
          continue;
        }
        const mine = items.filter((item) => item.ownerId === row.id && item.attributeId === attribute.id);
        values[attribute.id] = decodeValue(attribute.type, attribute.isMulti, mine);
      }
      const primaryId = object?.primaryAttributeId ?? null;
      const primaryItems = items.filter((item) => item.ownerId === row.id && item.attributeId === primaryId);
      const primary = primaryId === null ? undefined : attributes.get(primaryId);
      const name = primary === undefined ? '' : nameOf(decodeValue(primary.type, false, primaryItems));
      const hue = object === undefined ? undefined : hueOf(object.hue);
      const display: RecordRefDisplay = {
        objectId: row.objectId,
        recordId: row.id,
        name: name === '' ? `Unnamed ${(object?.singularName ?? 'record').toLowerCase()}` : name,
        kind: object?.standardKey === 'people' ? 'person' : object?.standardKey === 'companies' ? 'company' : 'other',
        ...(hue === undefined ? {} : { hue }),
      };
      return {
        id: row.id,
        objectId: row.objectId,
        createdAt: system.created_at as string,
        createdBy,
        updatedAt: system.updated_at as string,
        updatedBy,
        display,
        values,
      };
    })
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}
