// Creating records, setting their values and reading them back (spec 0004).
// Every write goes through runWrite and the value write protocol; every read
// runs inside withWorkspace().
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import {
  AttributeDefault,
  defaultKindsFor,
  HUES,
  type EngineRefusal,
  type Hue,
  type RecordRefDisplay,
} from '@crm/contracts/values';
import { takeRecordSlots } from './limits.ts';
import { decodeValue } from './columns.ts';
import { canonicalId, canonicalKeys, checkId, isUuid, isUuidV7 } from './ids.ts';
import { isRefusal, postgresError, refuse, refuseAll } from './refusals.ts';
import { actorRow, type Actor, type EngineScope } from './scope.ts';
import { LINK_CELL_CAP, linkValues, writeLinks } from './relationships.ts';
import {
  checkWriter,
  currentItems,
  holdDefinitions,
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
import { append, runWrite, type AfterWrite, type ValueChange, type WriteContext } from './write.ts';

const { attributeOptions, objects, records } = schema;

/** What a new record needs: its object, its values by attribute id, and optionally a client minted UUID v7. */
export interface RecordInput {
  readonly objectId: string;
  readonly values?: Readonly<Record<string, unknown>>;
  readonly id?: string;
  /** The creator's time zone, for date defaults such as "a month from today" (UTC when absent). */
  readonly timeZone?: string;
}

/**
 * A select or status default with its archived options left out, so archiving
 * the option a default names never stops records being created (AC-4, AC-11).
 * A multi default keeps its live options. A single default whose option is
 * archived gives no value, unless the attribute is required: then the first
 * live option in order stands in (a pipeline's next stage). The stored default
 * is left alone, so restoring the option brings it back.
 */
async function liveOptionDefault(tx: WorkspaceTx, attribute: AttributeDef, value: unknown): Promise<unknown> {
  const options = await tx
    .select({ id: attributeOptions.id, archivedAt: attributeOptions.archivedAt })
    .from(attributeOptions)
    .where(eq(attributeOptions.attributeId, attribute.id))
    .orderBy(asc(attributeOptions.position), asc(attributeOptions.id));
  const live = new Set(options.flatMap((option) => (option.archivedAt === null ? [option.id] : [])));
  const isLive = (id: unknown) => typeof id === 'string' && live.has(id);
  if (Array.isArray(value)) {
    const kept = value.filter(isLive);
    return value.length > 0 && kept.length === 0 ? undefined : kept;
  }
  if (typeof value !== 'string' || isLive(value)) return value;
  return attribute.isRequired ? [...live][0] : undefined;
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
  // A kind the type no longer allows (a static default stored on a timestamp before it was refused) gives nothing.
  if (!defaultKindsFor(attribute.type).includes(rule.kind)) return undefined;
  if (rule.kind === 'static') {
    return attribute.type === 'select' || attribute.type === 'status'
      ? liveOptionDefault(tx, attribute, rule.value)
      : rule.value;
  }
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
  /**
   * Each cell's current version id, by attribute id: the version of the write
   * that set it (a cleared cell keeps the clearing write's), and for a
   * reference that of its latest current link. A cell never set, a reference
   * with no current link, and a system attribute have none.
   */
  readonly versions: Readonly<Record<string, string>>;
  /**
   * For each multi reference cell cut short at `LINK_CELL_CAP` links (its
   * value lists the first 20 in order), how many live links it holds in all.
   * A cell that wasn't cut has no entry, so this is empty for most records.
   */
  readonly linkTotals: Readonly<Record<string, number>>;
}

/**
 * Parses every input against its attribute, collecting every refusal before
 * anything is written (AC-13). Only the system writes a system only type
 * (`SYSTEM_ONLY_TYPES`: timestamps and interactions); anyone else is refused
 * `ATTRIBUTE_READ_ONLY`. The attributes in `defaulted` got their value from
 * their default, which the system sets, so they pass whoever creates.
 */
function parseAll(
  attributes: ReadonlyMap<string, AttributeDef>,
  inputs: Readonly<Record<string, ValueInput>>,
  actor: Actor,
  earlier: readonly EngineRefusal[] = [],
  defaulted: ReadonlySet<string> = new Set(),
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
      if (!defaulted.has(attributeId)) checkWriter(attribute, actor);
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
async function writeOne(
  context: WriteContext,
  write: AttributeWrite,
  holdDefinition: () => Promise<void>,
): Promise<readonly ValueChange[]> {
  if (write.attribute.type === 'record_reference') return writeLinks(context, write);
  const change = await writeAttribute(context, write, holdDefinition);
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
  const holdDefinition = holdDefinitions(
    context.tx,
    parsed.map((each) => each.attribute),
  );
  for (const { attribute, input } of parsed) {
    const write = {
      ownerId,
      ownerKind,
      attribute,
      value: input.value,
      // Canonical on the way in: the write compares it with the stored version id as text.
      ...(input.baseVersionId === undefined ? {} : { baseVersionId: canonicalId(input.baseVersionId) }),
    };
    const landed = await writeOne(context, write, holdDefinition);
    const [change, ...far] = landed;
    if (change === undefined) {
      results[attribute.id] = {};
      continue;
    }
    // A loop, never `push(...far)`: clearing a multi end lists every far record, and spreading a list that
    // long as call arguments overflows the stack.
    changes.push(change);
    append(changes, far);
    results[attribute.id] =
      change.replaced === undefined
        ? { versionId: change.versionId }
        : { versionId: change.versionId, replaced: change.replaced };
  }
  // A link write lists the far records' reference values too, so their screens read them again. Their own
  // updated_at and updated_by stay put: the link row carries its own who and when, and writing the far rows
  // would lock records this write never asked for (two link writes from opposite ends would deadlock).
  context.record({ values: changes });
  return results;
}

/** Refuses an object that is missing or archived; returns its canonical id. */
async function liveObject(tx: WorkspaceTx, objectIdAsGiven: string): Promise<string> {
  const objectId = checkId(objectIdAsGiven, 'That object does not exist.');
  const [row] = await tx.select({ archivedAt: objects.archivedAt }).from(objects).where(eq(objects.id, objectId));
  if (row === undefined) throw refuse('NOT_FOUND', 'That object does not exist.');
  if (row.archivedAt !== null) throw refuse('NOT_FOUND', 'That object is archived. Restore it first.');
  return objectId;
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
  givenAsIs: Readonly<Record<string, unknown>>,
  timeZone: string,
): Promise<readonly { attribute: AttributeDef; input: ValueInput }[]> {
  const given = canonicalKeys(givenAsIs);
  // `Object.fromEntries` and `Object.hasOwn`, never `in`: a given `__proto__` key stays a key (refused as no
  // attribute), and nothing inherited counts as given.
  const inputs: Record<string, ValueInput> = Object.fromEntries(
    Object.entries(given).map(([id, value]) => [id, { value }]),
  );
  const defaulted = new Set<string>();
  for (const attribute of attributes.values()) {
    if (attribute.isSystem || attribute.archivedAt !== null || Object.hasOwn(given, attribute.id)) continue;
    const value = await defaultFor(tx, scope, attribute, timeZone);
    if (value === undefined) continue;
    inputs[attribute.id] = { value };
    defaulted.add(attribute.id);
  }
  const missing: EngineRefusal[] = [...attributes.values()]
    .filter(
      (attribute) =>
        attribute.isRequired &&
        !attribute.isSystem &&
        attribute.archivedAt === null &&
        attribute.type !== 'checkbox' &&
        !Object.hasOwn(inputs, attribute.id),
    )
    .map((attribute) => ({
      code: 'VALUE_REQUIRED',
      message: `${attribute.title} is required. Give it a value.`,
      attributeId: attribute.id,
    }));
  return parseAll(attributes, inputs, scope.actor, missing, defaulted);
}

/**
 * Creates one record inside a write (shared by single creates and batches).
 * Its record slot is taken last, after the record and its values are
 * written, as every write takes the workspace counter row last: the row is
 * held only for the end of the transaction, and a create never holds it
 * while it waits on another write's unique value. A full workspace refuses
 * there, and the refusal rolls the record and its values back.
 */
export async function insertRecord(context: WriteContext, input: RecordInput) {
  const { tx, scope } = context;
  const objectId = await liveObject(tx, input.objectId);
  const attributes = await loadAttributes(tx, objectId);
  const parsed = await initialValues(tx, scope, attributes, input.values ?? {}, input.timeZone ?? 'UTC');
  const by = actorRow(scope.actor);
  let recordId: string;
  try {
    const [row] = await tx
      .insert(records)
      .values({
        workspaceId: scope.workspaceId,
        ...(input.id === undefined ? {} : { id: canonicalId(input.id) }),
        objectId,
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
  context.record({ createdRecords: [{ recordId, objectId }] });
  const versions = await writeAll(context, 'record', recordId, parsed);
  await takeRecordSlots(tx, scope, 1);
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

/**
 * Locks the record or entry a write names and loads its attributes. The owner
 * id comes back canonical, and is the one used from then on: an upper case
 * spelling would compare unequal to the ids the database returns (a record
 * could link to itself) and reach the hooks as a second spelling.
 */
async function lockOwner(
  tx: WorkspaceTx,
  input: RecordValues | EntryValues,
): Promise<{
  ownerKind: 'record' | 'entry';
  ownerId: string;
  attributes: ReadonlyMap<string, AttributeDef>;
}> {
  if ('entryId' in input) {
    const entryId = checkId(input.entryId, 'That entry does not exist.');
    const { listId } = await lockEntry(tx, entryId);
    return { ownerKind: 'entry', ownerId: entryId, attributes: await loadListAttributes(tx, listId) };
  }
  const recordId = checkId(input.recordId, 'That record does not exist.');
  const { objectId } = await lockRecord(tx, recordId);
  return { ownerKind: 'record', ownerId: recordId, attributes: await loadAttributes(tx, objectId) };
}

/** Sets values on one record or entry inside a write: the owner is locked, then every value is parsed, then written. */
async function updateRecord(
  context: WriteContext,
  input: RecordValues | EntryValues,
): Promise<Record<string, AttributeResult>> {
  const { tx } = context;
  const { ownerKind, ownerId, attributes } = await lockOwner(tx, input);
  const parsed = parseAll(attributes, canonicalKeys(input.values), context.scope.actor);
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
        const outcome = await context.perRecord((child) => updateRecord(child, item));
        const recordId = canonicalId(item.recordId);
        outcomes.push(
          outcome.ok
            ? { recordId, ok: true, results: outcome.value }
            : { recordId, ok: false, refusals: outcome.refusals },
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

/**
 * Groups item rows by owner and attribute once, so a read looks each pair up
 * instead of scanning every item for every row and attribute.
 */
export function bucketItems<T extends { readonly ownerId: string; readonly attributeId: string }>(
  items: readonly T[],
): (ownerId: string, attributeId: string) => readonly T[] {
  const byOwner = new Map<string, Map<string, T[]>>();
  for (const item of items) {
    const byAttribute = byOwner.get(item.ownerId) ?? new Map<string, T[]>();
    byOwner.set(item.ownerId, byAttribute);
    const list = byAttribute.get(item.attributeId) ?? [];
    byAttribute.set(item.attributeId, list);
    list.push(item);
  }
  return (ownerId, attributeId) => byOwner.get(ownerId)?.get(attributeId) ?? [];
}

/**
 * Reads live records with their current values and display (AC-19). Up to 500
 * at once. A malformed id (or attribute id) names nothing, so it is left out
 * like a missing one rather than failing the whole read.
 */
export async function getRecords(
  scope: EngineScope,
  input: { readonly ids: readonly string[]; readonly attributeIds?: readonly string[] },
): Promise<readonly RecordView[]> {
  if (input.ids.length > 500) throw refuse('CONFIG_INVALID', 'Read at most 500 records at once.');
  // Canonical ids, so the rows (which come back lower case) find their place in the order asked for.
  const ids = input.ids.filter(isUuid).map(canonicalId);
  const attributeIds = input.attributeIds?.filter(isUuid).map(canonicalId);
  if (ids.length === 0) return [];
  return scope.db.withWorkspace(scope.workspaceId, (tx) => readRecords(tx, ids, attributeIds));
}

/**
 * Reads live records inside an open transaction, in the order of `ids`. A
 * multi reference cell lists at most `LINK_CELL_CAP` links, with its total in
 * `linkTotals` when cut short.
 */
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
    { withCleared: true },
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
    { cap: LINK_CELL_CAP },
  );
  const order = new Map(input.ids.map((id, index) => [canonicalId(id), index]));
  const itemsOf = bucketItems(items.filter((item) => !item.isCleared));
  // A cell's version is its newest row's (uuid v7, so the greatest), a cleared marker's included.
  const versionOf = new Map<string, string>();
  for (const item of items) {
    const key = `${item.ownerId}:${item.attributeId}`;
    const seen = versionOf.get(key);
    if (seen === undefined || item.versionId > seen) versionOf.set(key, item.versionId);
  }

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
      const versions: Record<string, string> = {};
      const linkTotals: Record<string, number> = {};
      for (const attribute of attributes.values()) {
        if (input.attributeIds !== undefined && !input.attributeIds.includes(attribute.id)) continue;
        if (attribute.systemColumn !== null) {
          values[attribute.id] = system[attribute.systemColumn];
          continue;
        }
        if (attribute.type === 'record_reference') {
          values[attribute.id] = links.values.get(row.id)?.get(attribute.id) ?? (attribute.isMulti ? [] : null);
          const total = links.totals.get(row.id)?.get(attribute.id);
          if (total !== undefined) linkTotals[attribute.id] = total;
          const linked = links.versions.get(row.id)?.get(attribute.id);
          if (linked !== undefined) versions[attribute.id] = linked;
          continue;
        }
        values[attribute.id] = decodeValue(attribute.type, attribute.isMulti, itemsOf(row.id, attribute.id));
        const version = versionOf.get(`${row.id}:${attribute.id}`);
        if (version !== undefined) versions[attribute.id] = version;
      }
      const primaryId = object?.primaryAttributeId ?? null;
      const primaryItems = primaryId === null ? [] : itemsOf(row.id, primaryId);
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
        versions,
        linkTotals,
      };
    })
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}
