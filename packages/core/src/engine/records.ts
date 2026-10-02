// Creating records, setting their values and reading them back (spec 0004).
// Every write goes through runWrite and the value write protocol; every read
// runs inside withWorkspace().
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import { AttributeDefault, HUES, type EngineRefusal, type Hue, type RecordRefDisplay } from '@crm/contracts/values';
import { takeRecordSlots } from './limits.ts';
import { decodeValue } from './columns.ts';
import { isUuidV7 } from './ids.ts';
import { isRefusal, postgresError, refuse, refuseAll } from './refusals.ts';
import { actorRow, type Actor, type EngineScope } from './scope.ts';
import { linkValues, writeLinks } from './relationships.ts';
import {
  currentItems,
  loadAttributes,
  loadListAttributes,
  lockEntry,
  lockRecord,
  parseFor,
  touchOwner,
  writeAttribute,
  type AttributeDef,
  type AttributeWrite,
} from './values.ts';
import { runWrite, type AfterWrite, type ValueChange, type WriteContext } from './write.ts';

const { objects, records } = schema;

/** What a new record needs: its object, its values by attribute id, and optionally a client minted UUID v7. */
export interface RecordInput {
  readonly objectId: string;
  readonly values?: Readonly<Record<string, unknown>>;
  readonly id?: string;
  /** The creator's time zone, for date defaults such as "a month from today" (UTC when absent). */
  readonly timeZone?: string;
}

/** The value a default gives a new record, or undefined when it gives none (a current user default for a non member). */
async function defaultFor(
  tx: WorkspaceTx,
  scope: EngineScope,
  attribute: AttributeDef,
  timeZone: string,
): Promise<unknown> {
  const parsed = AttributeDefault.safeParse(attribute.defaultValue);
  if (!parsed.success) return undefined;
  const rule = parsed.data;
  if (rule.kind === 'static') return rule.value;
  if (rule.kind === 'current_user')
    return scope.actor.type === 'member' ? { type: 'member', id: scope.actor.id } : undefined;
  const offset = sql`${rule.duration}::interval`;
  try {
    const result =
      attribute.type === 'date'
        ? await tx.execute<{ value: string }>(
            sql`select ((now() at time zone ${timeZone}) + ${offset})::date::text as value`,
          )
        : await tx.execute<{ value: string }>(
            sql`select to_char((now() + ${offset}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as value`,
          );
    return result.rows[0]?.value;
  } catch (error) {
    if (postgresError(error)?.code === '22023') throw refuse('CONFIG_INVALID', 'That time zone is not known.');
    throw error;
  }
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
  earlier: readonly EngineRefusal[] = [],
): readonly { attribute: AttributeDef; input: ValueInput }[] {
  const refusals: EngineRefusal[] = [...earlier];
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

/** Writes one attribute: links for a record reference, value rows for every other type. */
async function writeOne(context: WriteContext, write: AttributeWrite): Promise<readonly ValueChange[]> {
  if (write.attribute.type === 'record_reference') return writeLinks(context, write);
  const change = await writeAttribute(context, write);
  return change === undefined ? [] : [change];
}

/** Writes parsed inputs to one record or entry, returning each attribute's result. Record references write links. */
export async function writeAll(
  context: WriteContext,
  ownerKind: 'record' | 'entry',
  ownerId: string,
  parsed: readonly { attribute: AttributeDef; input: ValueInput }[],
): Promise<Record<string, AttributeResult>> {
  const results: Record<string, AttributeResult> = {};
  const changes: ValueChange[] = [];
  for (const { attribute, input } of parsed) {
    const write = {
      ownerId,
      ownerKind,
      attribute,
      value: input.value,
      ...(input.baseVersionId === undefined ? {} : { baseVersionId: input.baseVersionId }),
    };
    const landed = await writeOne(context, write);
    const [change, ...far] = landed;
    if (change === undefined) {
      results[attribute.id] = {};
      continue;
    }
    changes.push(change, ...far);
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

/** Creates a record with its first values, defaults filled in and required ones checked (AC-1, AC-2, AC-11, AC-13, AC-16). */
export async function createRecord(scope: EngineScope, input: RecordInput, hooks: readonly AfterWrite[] = []) {
  if (input.id !== undefined && !isUuidV7(input.id)) {
    throw refuse('CONFIG_INVALID', 'A record id the client chooses must be a UUID v7.');
  }
  const { result } = await runWrite(scope, (context) => insertRecord(context, input), hooks);
  return result;
}

/**
 * A new record's or entry's first values: the given ones, each default filled
 * in, and a refusal for every required one still missing, all parsed (AC-11).
 */
export async function initialValues(
  tx: WorkspaceTx,
  scope: EngineScope,
  attributes: ReadonlyMap<string, AttributeDef>,
  given: Readonly<Record<string, unknown>>,
  timeZone: string,
): Promise<readonly { attribute: AttributeDef; input: ValueInput }[]> {
  const inputs: Record<string, ValueInput> = Object.fromEntries(
    Object.entries(given).map(([id, value]) => [id, { value }]),
  );
  for (const attribute of attributes.values()) {
    if (attribute.isSystem || attribute.archivedAt !== null || attribute.id in given) continue;
    const value = await defaultFor(tx, scope, attribute, timeZone);
    if (value !== undefined) inputs[attribute.id] = { value };
  }
  const missing: EngineRefusal[] = [...attributes.values()]
    .filter(
      (attribute) =>
        attribute.isRequired &&
        !attribute.isSystem &&
        attribute.archivedAt === null &&
        attribute.type !== 'checkbox' &&
        !(attribute.id in inputs),
    )
    .map((attribute) => ({
      code: 'VALUE_REQUIRED',
      message: `${attribute.title} is required. Give it a value.`,
      attributeId: attribute.id,
    }));
  return parseAll(attributes, inputs, missing);
}

/** Creates one record inside a write (shared by single creates and batches). */
export async function insertRecord(context: WriteContext, input: RecordInput) {
  const { tx, scope } = context;
  await liveObject(tx, input.objectId);
  const attributes = await loadAttributes(tx, input.objectId);
  const parsed = await initialValues(tx, scope, attributes, input.values ?? {}, input.timeZone ?? 'UTC');
  await takeRecordSlots(tx, scope, 1);
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
  const versions = await writeAll(context, 'record', recordId, parsed);
  return { recordId, versions };
}

/** Sets values on a record, or on a list entry, all or none (AC-3, AC-6, AC-12, AC-13). */
export async function setValues(
  scope: EngineScope,
  input: RecordValues | EntryValues,
  hooks: readonly AfterWrite[] = [],
): Promise<Record<string, AttributeResult>> {
  const { result } = await runWrite(scope, (context) => updateRecord(context, input), hooks);
  return result;
}

/** One record's new values. */
export interface RecordValues {
  readonly recordId: string;
  readonly values: Readonly<Record<string, ValueInput>>;
}

/** One list entry's new values (its own, not its record's). */
export interface EntryValues {
  readonly entryId: string;
  readonly values: Readonly<Record<string, ValueInput>>;
}

/** Sets values on one record or entry inside a write: the owner is locked, then every value is parsed, then written. */
async function updateRecord(
  context: WriteContext,
  input: RecordValues | EntryValues,
): Promise<Record<string, AttributeResult>> {
  const { tx } = context;
  const [ownerKind, ownerId, attributes] =
    'entryId' in input
      ? (['entry', input.entryId, await loadListAttributes(tx, (await lockEntry(tx, input.entryId)).listId)] as const)
      : ([
          'record',
          input.recordId,
          await loadAttributes(tx, (await lockRecord(tx, input.recordId)).objectId),
        ] as const);
  const parsed = parseAll(attributes, input.values);
  const results = await writeAll(context, ownerKind, ownerId, parsed);
  if (Object.values(results).some((each) => each.versionId !== undefined)) {
    await touchOwner(context, ownerKind, ownerId);
  }
  return results;
}

/** One record's outcome in a batch. */
export type BatchResult =
  | { readonly recordId: string; readonly ok: true; readonly results: Record<string, AttributeResult> }
  | { readonly recordId: string; readonly ok: false; readonly refusals: readonly EngineRefusal[] };

/** The most records one batch may change. */
export const MAX_BATCH = 500;

/**
 * Sets values on up to 500 records in one transaction. Each record lands all
 * or nothing under its own savepoint; the hooks see only those that landed (AC-13).
 */
export async function setValuesBatch(
  scope: EngineScope,
  input: { readonly items: readonly RecordValues[] },
  hooks: readonly AfterWrite[] = [],
): Promise<readonly BatchResult[]> {
  if (input.items.length > MAX_BATCH)
    throw refuse('CONFIG_INVALID', `Change at most ${String(MAX_BATCH)} records at once.`);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const outcomes: BatchResult[] = [];
      for (const item of input.items) {
        const outcome = await context.perRecord(() => updateRecord(context, item));
        outcomes.push(
          outcome.ok
            ? { recordId: item.recordId, ok: true, results: outcome.value }
            : { recordId: item.recordId, ok: false, refusals: outcome.refusals },
        );
      }
      return outcomes;
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
  const references = [...attributesByObject.values()].flatMap((byId) =>
    [...byId.values()].filter(
      (attribute) =>
        attribute.type === 'record_reference' &&
        (input.attributeIds === undefined || input.attributeIds.includes(attribute.id)),
    ),
  );
  const links = await linkValues(
    tx,
    rows.map((row) => row.id),
    references,
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
        if (attribute.type === 'record_reference') {
          values[attribute.id] = links.get(row.id)?.get(attribute.id) ?? (attribute.isMulti ? [] : null);
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
