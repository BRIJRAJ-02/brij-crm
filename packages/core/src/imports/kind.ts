// `records.import` (spec 0040, AC-1119, AC-1124 to AC-1126): an import's
// staged rows written through the engine as the member who started it. An
// item kind on the heavy lane, cancellable, 100 rows a batch: each batch is
// one engine transaction, and each row its own savepoint, in which the row
// takes a transaction lock on its match keys, finds the live record holding
// one (only a record the member can read), then creates or updates it by the
// import's rules (an empty cell never clears; a list gains the file's items)
// and stores its outcome, its record, what it replaced and the versions it
// wrote beside the write. A refused row stores why, and the rest carry on. A
// row whose outcome is no longer pending (a batch tried again after its
// commit) is skipped, so no row is written twice. An import into a list (spec
// 0048, AC-4833) then adds the row's record to the list with the row's list
// values, or, in an "Each record once" list already holding it, updates that
// entry's values; the entry it added is kept on the row for the undo.
import { and, eq, sql } from 'drizzle-orm';
import * as z from 'zod';
import { ImportSettings, type EngineRefusal } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { canonicalId } from '../engine/ids.ts';
import { checkObject } from '../access/visibility.ts';
import { memberScopeIn, type RuleSource } from '../access/door.ts';
import { objectLevel } from '../access/policy.ts';
import { queueImportFinished } from '../emails/queue.ts';
import { limitsOf, takeRecordSlots } from '../engine/limits.ts';
import { insertRecord, readRecords, updateRecord } from '../engine/records.ts';
import { addEntryIn } from '../engine/lists.ts';
import { isRefusal, refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { loadAttributes, loadListAttributes, type AttributeDef } from '../engine/values.ts';
import type { WriteContext } from '../engine/write.ts';
import { defineKind, MAX_ATTEMPTS, type ItemOutcome, type KindDefinition } from '../jobs/registry.ts';
import {
  farObjects,
  foldName,
  linkValue,
  madeValues,
  namesOf,
  namesTaken,
  resolveNames,
  type FarObject,
  type Resolved,
} from './links.ts';
import { RECORDS_IMPORT, readableMatches } from './service.ts';
import { checkSettings, countRows } from './shared.ts';
import { parseAttributeInput } from '../engine/parse-value.ts';

const { imports, objects, workspaceCounters } = schema;

/** The kind's params: the import whose rows it writes. */
export const ImportJobParams = z.strictObject({ importId: z.uuid() });
/** The kind's params. */
export type ImportJobParams = z.infer<typeof ImportJobParams>;

/** Rows a batch writes: one transaction holding their locks and keys for under a second. */
export const IMPORT_BATCH = 100;

/** One staged row as the job reads it. */
type StagedRow = {
  readonly id: string;
  readonly row_number: number;
  readonly values: unknown;
  readonly match_keys: string[];
  readonly outcome: string;
};

/** What one batch knows of its import: settings, object, attributes, and each relation column's far objects. */
interface ImportPlan {
  readonly importId: string;
  readonly objectId: string;
  /** The file's name, which the job's summary carries so a list of jobs can name the import. */
  readonly fileName: string;
  readonly settings: ImportSettings;
  readonly attributes: ReadonlyMap<string, AttributeDef>;
  /** The list the rows go into (spec 0048, AC-4833), and its fields, which take columns beside the object's. */
  readonly listId?: string;
  readonly listAttributes: ReadonlyMap<string, AttributeDef>;
  readonly far: ReadonlyMap<string, readonly FarObject[]>;
  /** Relation columns that make a far record for a name that links to none: the far object and its attributes. */
  readonly makes: ReadonlyMap<string, MakeTarget>;
}

/** Where a relation column's missing names go when it makes them: its one far object, and that object's attributes. */
interface MakeTarget {
  readonly far: FarObject;
  readonly attributes: ReadonlyMap<string, AttributeDef>;
}

/** A far record a row made for a name. */
interface Made {
  readonly objectId: string;
  readonly recordId: string;
}

/** What one row did, as its savepoint answers it. */
interface RowResult {
  readonly outcome: 'created' | 'updated' | 'skipped';
  readonly note?: string;
}

/** True for no value: null, undefined, or an empty list. */
function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || (Array.isArray(value) && value.length === 0);
}

/** A value's identity for comparing one item with another: a link by its record, anything else whole. */
const identity = (value: unknown): string =>
  typeof value === 'object' && value !== null && 'recordId' in value && typeof value.recordId === 'string'
    ? `record:${value.recordId}`
    : JSON.stringify(value);

/**
 * What to write for one attribute on a matched record (decision 2): a list
 * gains the file's items it lacks (whatever the rule); a single value is
 * written when the record's is empty, or with `overwrite` when it differs.
 * Undefined writes nothing.
 */
export function mergeValue(
  attribute: Pick<AttributeDef, 'isMulti'>,
  file: unknown,
  current: unknown,
  rule: 'fill' | 'overwrite',
): unknown {
  if (isEmpty(file)) return undefined;
  if (attribute.isMulti && Array.isArray(file)) {
    const held: readonly unknown[] = Array.isArray(current) ? current : [];
    const seen = new Set(held.map(identity));
    const added = file.filter((item) => !seen.has(identity(item)));
    return added.length === 0 ? undefined : [...held, ...(added as readonly unknown[])];
  }
  if (!isEmpty(current) && rule === 'fill') return undefined;
  return identity(current) === identity(file) ? undefined : file;
}

/** A value as its type's schema reads it (canonical: lower case emails, trimmed text), or as given when it doesn't parse. */
function canonical(attribute: AttributeDef, value: unknown): unknown {
  if (attribute.type === 'record_reference') return value;
  const parsed = parseAttributeInput(attribute, value);
  return parsed.ok ? parsed.value : value;
}

/** The plain sentence a refused row stores: its refusals' messages, the first three. */
export function refusalText(refusals: readonly EngineRefusal[]): { code: string; message: string } {
  const [first] = refusals;
  const message = refusals
    .slice(0, 3)
    .map((refusal) => refusal.message)
    .join(' ');
  return { code: first?.code ?? 'CONFIG_INVALID', message: message === '' ? 'This row was refused.' : message };
}

/** Reads the import and what every batch needs of it, or undefined when it is gone. */
async function loadPlan(tx: WorkspaceTx, scope: EngineScope, importId: string): Promise<ImportPlan | undefined> {
  const [row] = await tx
    .select()
    .from(imports)
    .where(and(eq(imports.workspaceId, scope.workspaceId), eq(imports.id, importId)));
  if (row === undefined) return undefined;
  const settings = ImportSettings.parse(row.settings);
  const attributes = await loadAttributes(tx, row.objectId);
  const far = new Map<string, readonly FarObject[]>();
  const makes = new Map<string, MakeTarget>();
  for (const column of settings.columns) {
    const attribute = column.target === undefined ? undefined : attributes.get(column.target.attributeId);
    if (attribute?.type === 'record_reference' && !far.has(attribute.id)) {
      const ends = await farObjects(tx, attribute);
      far.set(attribute.id, ends);
      const [only] = ends;
      if (column.target?.createMissing === true && only !== undefined && ends.length === 1) {
        makes.set(attribute.id, { far: only, attributes: await loadAttributes(tx, only.objectId) });
      }
    }
  }
  const listAttributes =
    row.listId === null ? new Map<string, AttributeDef>() : await loadListAttributes(tx, row.listId);
  return {
    importId: row.id,
    objectId: row.objectId,
    fileName: row.fileName,
    settings,
    attributes,
    ...(row.listId === null ? {} : { listId: row.listId }),
    listAttributes,
    far,
    makes,
  };
}

/** A row's staged values: plain ones by attribute, and each relation column's names. */
function stagedValues(
  plan: ImportPlan,
  staged: unknown,
): { readonly values: Map<string, unknown>; readonly names: Map<string, readonly string[]> } {
  const given = typeof staged === 'object' && staged !== null ? (staged as Record<string, unknown>) : {};
  const values = new Map<string, unknown>();
  const names = new Map<string, readonly string[]>();
  for (const [id, value] of Object.entries(given)) {
    const attributeId = canonicalId(id);
    const attribute = plan.attributes.get(attributeId);
    if (attribute === undefined) continue;
    if (attribute.type === 'record_reference') {
      const held = namesOf(value);
      if (held !== undefined && held.length > 0) names.set(attributeId, namesTaken(attribute, held));
      continue;
    }
    if (!isEmpty(value)) values.set(attributeId, value);
  }
  return { values, names };
}

/**
 * Turns a row's relation names into links, from the names the batch
 * resolved. A name that links to none, in a column that makes them, makes a
 * far record first (inside the row's savepoint, so a refused row takes it
 * back; refused, the row is refused with why). Answers the values, a note
 * for each name left out, and the records made.
 */
async function linkRow(
  context: WriteContext,
  plan: ImportPlan,
  batch: BatchState,
  row: { readonly values: Map<string, unknown>; readonly names: Map<string, readonly string[]> },
): Promise<{
  readonly values: Map<string, unknown>;
  readonly notes: readonly string[];
  readonly made: Map<string, Made>;
}> {
  const values = new Map(row.values);
  const notes: string[] = [];
  const made = new Map<string, Made>();
  for (const [attributeId, names] of row.names) {
    const attribute = plan.attributes.get(attributeId);
    if (attribute === undefined) continue;
    const known = batch.resolved.get(attributeId) ?? new Map<string, Resolved>();
    const make = batch.makes.get(attributeId);
    const resolved = new Map(known);
    for (const name of names) {
      const fold = foldName(name);
      const each = known.get(fold);
      if (make === undefined || each === undefined || each.ok || !each.missing) continue;
      const key = `${attributeId}:${fold}`;
      const already = made.get(key);
      if (already !== undefined) {
        resolved.set(fold, { ok: true, ...already });
        continue;
      }
      if (batch.room - made.size <= 0) {
        throw refuse(
          'LIMIT_REACHED',
          `This workspace holds at most ${limitsOf(context.scope).liveRecords.toLocaleString('en')} records.`,
        );
      }
      const start = madeValues(make.attributes, make.far.nameAttributeId, name);
      if (start === undefined) continue;
      try {
        const created = await insertRecord(
          context,
          { objectId: make.far.objectId, values: start },
          { attributes: make.attributes, countsSlots: true },
        );
        const link = { objectId: make.far.objectId, recordId: created.recordId };
        made.set(key, link);
        resolved.set(fold, { ok: true, ...link });
      } catch (error) {
        if (!isRefusal(error)) throw error;
        throw refuse(error.refusal.code, `Couldn’t make a record for “${name}”. ${error.refusal.message}`);
      }
    }
    const linked = linkValue(attribute, names, resolved);
    notes.push(...linked.notes);
    if (linked.value !== undefined) values.set(attributeId, linked.value);
  }
  return { values, notes, made };
}

/**
 * What one batch holds for its rows (spec 0040's scale check): the records
 * its match keys name (found once for the batch, then kept up to date as
 * its rows create records), the room left under the record limit, and the
 * outcomes to store, written in one statement when the batch ends, in the
 * same transaction as the writes.
 */
interface BatchState {
  readonly matches: Map<string, string>;
  /** Each relation column's names, resolved once for the batch, then kept up to date as rows make far records. */
  readonly resolved: Map<string, Map<string, Resolved>>;
  /** The relation columns that may make far records this batch (their far object still writable and live). */
  readonly makes: ReadonlyMap<string, MakeTarget>;
  room: number;
  created: number;
  readonly stored: StoredOutcome[];
}

/** One row's outcome as the batch stores it. */
interface StoredOutcome {
  readonly row_number: number;
  readonly outcome: 'created' | 'updated' | 'skipped' | 'refused';
  readonly record_id?: string;
  readonly error_code?: string;
  readonly error_message?: string;
  readonly before?: unknown;
  readonly written?: unknown;
  readonly made?: readonly Made[];
  readonly entry_id?: string;
}

/** Takes every match key's lock of the batch in one order, so two imports of one new key meet in turn (two rows never both create). */
async function lockKeys(tx: WorkspaceTx, plan: ImportPlan, keys: readonly string[]): Promise<void> {
  const attributeId = plan.settings.matchAttributeId;
  if (attributeId === undefined || keys.length === 0) return;
  const names = [...new Set(keys)].sort().map((key) => `import-match:${plan.objectId}:${attributeId}:${key}`);
  await tx.execute(sql`
    select pg_advisory_xact_lock(hashtextextended(name, 0))
    from unnest(array(select jsonb_array_elements_text(${JSON.stringify(names)}::jsonb))) with ordinality as k(name, n)
    order by n
  `);
}

/** Writes one row inside its savepoint: matched, then created, updated or skipped by the rules; its outcome kept for the batch. */
async function importRow(
  context: WriteContext,
  plan: ImportPlan,
  row: StagedRow,
  batch: BatchState,
): Promise<{ readonly result: RowResult; readonly stored: StoredOutcome; readonly made: ReadonlyMap<string, Made> }> {
  const { tx, scope } = context;
  const { settings } = plan;
  const matchId =
    settings.matchAttributeId === undefined
      ? undefined
      : row.match_keys.map((key) => batch.matches.get(key)).find((id) => id !== undefined);
  const nothing = new Map<string, Made>();
  if (matchId === undefined && settings.onNoMatch === 'skip') {
    return {
      result: { outcome: 'skipped' },
      stored: { row_number: row.row_number, outcome: 'skipped' },
      made: nothing,
    };
  }
  if (matchId !== undefined && settings.onMatch === 'skip') {
    return {
      result: { outcome: 'skipped' },
      stored: { row_number: row.row_number, outcome: 'skipped', record_id: matchId },
      made: nothing,
    };
  }
  const staged = stagedValues(plan, row.values);
  const rule = settings.onMatch === 'overwrite' ? 'overwrite' : 'fill';
  // A matched record is read first, so a relation it keeps (one link held under Fill, or a list cut short on read)
  // never makes a far record nothing would point to.
  const [current] =
    matchId === undefined
      ? []
      : await readRecords(tx, scope.access, [matchId], {
          attributeIds: [...staged.values.keys(), ...staged.names.keys()],
        });
  const names = new Map(
    [...staged.names].filter(([attributeId]) => {
      if (matchId === undefined) return true;
      const attribute = plan.attributes.get(attributeId);
      if (attribute === undefined || current?.linkTotals[attributeId] !== undefined) return false;
      return attribute.isMulti || rule === 'overwrite' || isEmpty(current?.values[attributeId] ?? null);
    }),
  );
  const { values, notes, made } = await linkRow(context, plan, batch, { values: staged.values, names });
  const note = notes.length === 0 ? undefined : notes.slice(0, 3).join(' ');
  const noted = note === undefined ? {} : { error_code: 'LINK_NOT_FOUND', error_message: note };
  const madeList = [...made.values()];
  const base = { row_number: row.row_number, ...noted, ...(madeList.length === 0 ? {} : { made: madeList }) };

  if (matchId === undefined) {
    // The record limit, counted for the batch: a row past it is refused as a create would be.
    if (batch.room - made.size <= 0)
      throw refuse(
        'LIMIT_REACHED',
        `This workspace holds at most ${limitsOf(scope).liveRecords.toLocaleString('en')} records.`,
      );
    const created = await insertRecord(
      context,
      { objectId: plan.objectId, values: Object.fromEntries(values) },
      { attributes: plan.attributes, countsSlots: true },
    );
    // The versions the create wrote, kept as an update's are: the undo reads them to tell a record nobody has
    // touched since from one that has been worked on, and never trashes the second.
    const wrote = Object.fromEntries(
      Object.entries(created.versions).flatMap(([id, result]) =>
        result.versionId === undefined ? [] : [[id, result.versionId]],
      ),
    );
    return {
      result: { outcome: 'created', ...(note === undefined ? {} : { note }) },
      stored: {
        ...base,
        outcome: 'created',
        record_id: created.recordId,
        ...(Object.keys(wrote).length === 0 ? {} : { written: wrote }),
      },
      made,
    };
  }

  const skipped = {
    result: { outcome: 'skipped' as const },
    stored: { ...base, outcome: 'skipped' as const, record_id: matchId },
    made,
  };
  const next: Record<string, { value: unknown }> = {};
  const before: Record<string, { value: unknown; versionId?: string }> = {};
  for (const [attributeId, value] of values) {
    const attribute = plan.attributes.get(attributeId);
    if (attribute === undefined) continue;
    // A link list cut short on read isn't whole, so writing it back would drop links: it is left as it is.
    if (current?.linkTotals[attributeId] !== undefined) continue;
    const held = current?.values[attributeId] ?? null;
    const merged = mergeValue(attribute, canonical(attribute, value), held, rule);
    if (merged === undefined) continue;
    next[attributeId] = { value: merged };
    const versionId = current?.versions[attributeId];
    before[attributeId] = versionId === undefined ? { value: held } : { value: held, versionId };
  }
  if (Object.keys(next).length === 0) return skipped;
  const results = await updateRecord(context, { recordId: matchId, values: next });
  const written = Object.fromEntries(
    Object.entries(results).flatMap(([id, result]) => (result.versionId === undefined ? [] : [[id, result.versionId]])),
  );
  if (Object.keys(written).length === 0) return skipped;
  const kept = Object.fromEntries(Object.entries(before).filter(([id]) => Object.hasOwn(written, id)));
  return {
    result: { outcome: 'updated', ...(note === undefined ? {} : { note }) },
    stored: { ...base, outcome: 'updated', record_id: matchId, before: kept, written },
    made,
  };
}

/** A row's values for the list's own fields (spec 0048, AC-4833), by attribute id; empty ones left out. */
function listValuesOf(plan: ImportPlan, staged: unknown): Record<string, unknown> {
  const given = typeof staged === 'object' && staged !== null ? (staged as Record<string, unknown>) : {};
  return Object.fromEntries(
    Object.entries(given).flatMap(([id, value]) => {
      const attributeId = canonicalId(id);
      return plan.listAttributes.has(attributeId) && !isEmpty(value) ? [[attributeId, value]] : [];
    }),
  );
}

/**
 * Writes one row, then (into a list) its entry, inside the row's savepoint
 * (AC-4833): the row's record added with the row's list values; in an "Each
 * record once" list that holds it already (a second row for one record
 * included), that entry's values updated. A row that changed only its entry
 * counts as updated. A refused add refuses the row whole.
 */
async function importRowInto(
  context: WriteContext,
  plan: ImportPlan,
  row: StagedRow,
  batch: BatchState,
): Promise<{ readonly result: RowResult; readonly stored: StoredOutcome; readonly made: ReadonlyMap<string, Made> }> {
  const done = await importRow(context, plan, row, batch);
  const recordId = done.stored.record_id;
  if (plan.listId === undefined || recordId === undefined) return done;
  const values = listValuesOf(plan, row.values);
  const entry = await addEntryIn(context, { listId: plan.listId, recordId, values });
  if (entry.existing) {
    const next = Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { value }]));
    if (Object.keys(next).length === 0) return done;
    const results = await updateRecord(context, { entryId: entry.entryId, values: next });
    if (!Object.values(results).some((result) => result.versionId !== undefined)) return done;
  }
  const changed = done.result.outcome === 'skipped' ? 'updated' : done.result.outcome;
  return {
    result: { ...done.result, outcome: changed },
    stored: { ...done.stored, outcome: changed, ...(entry.existing ? {} : { entry_id: entry.entryId }) },
    made: done.made,
  };
}

/** Stores the batch's outcomes in one statement (each row by its number). */
async function storeOutcomes(tx: WorkspaceTx, scope: EngineScope, importId: string, stored: readonly StoredOutcome[]) {
  if (stored.length === 0) return;
  await tx.execute(sql`
    update import_rows as r set
      outcome = v.outcome::import_row_outcome,
      record_id = coalesce(v.record_id, r.record_id),
      error_code = v.error_code,
      error_message = v.error_message,
      before = coalesce(v.before, r.before),
      written = coalesce(v.written, r.written),
      made = coalesce(v.made, r.made),
      entry_id = coalesce(v.entry_id, r.entry_id)
    from jsonb_to_recordset(${JSON.stringify(stored)}::jsonb) as v(
      row_number int, outcome text, record_id uuid, error_code text, error_message text, before jsonb, written jsonb,
      made jsonb, entry_id uuid
    )
    where r.workspace_id = ${scope.workspaceId} and r.import_id = ${importId} and r.row_number = v.row_number
  `);
}

/** Every relation column's names across the batch's rows, resolved at once (a few queries a batch, none a row). */
async function resolveBatch(
  tx: WorkspaceTx,
  scope: EngineScope,
  plan: ImportPlan,
  rows: readonly StagedRow[],
): Promise<Map<string, Map<string, Resolved>>> {
  const wanted = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const [attributeId, names] of stagedValues(plan, row.values).names) {
      const set = wanted.get(attributeId) ?? new Set<string>();
      for (const name of names) set.add(name);
      wanted.set(attributeId, set);
    }
  }
  const resolved = new Map<string, Map<string, Resolved>>();
  for (const [attributeId, names] of wanted) {
    const found = await resolveNames(tx, scope, plan.far.get(attributeId) ?? [], [...names]);
    resolved.set(attributeId, new Map(found));
  }
  return resolved;
}

/**
 * The relation columns that may make far records this batch: the far object
 * still live and writable by the member. One that lost it makes nothing, and
 * its missing names are left out and said, as without `createMissing`.
 */
async function writableMakes(
  tx: WorkspaceTx,
  scope: EngineScope,
  plan: ImportPlan,
): Promise<ReadonlyMap<string, MakeTarget>> {
  const makes = new Map<string, MakeTarget>();
  for (const [attributeId, make] of plan.makes) {
    try {
      await checkObject(tx, scope.access, make.far.objectId, 'write');
      await liveImportObject(tx, make.far.objectId);
      makes.set(attributeId, make);
    } catch (error) {
      if (!isRefusal(error) || error.refusal.code === 'QUERY_CANCELLED') throw error;
    }
  }
  return makes;
}

/** The records the workspace may still make under its limit, read once a batch. */
async function recordRoom(tx: WorkspaceTx, scope: EngineScope): Promise<number> {
  const [row] = await tx
    .select({ liveRecords: workspaceCounters.liveRecords })
    .from(workspaceCounters)
    .where(eq(workspaceCounters.workspaceId, scope.workspaceId));
  return limitsOf(scope).liveRecords - (row?.liveRecords ?? 0);
}

/** Refuses NOT_FOUND when the import's object is gone or archived. */
async function liveImportObject(tx: WorkspaceTx, objectId: string): Promise<void> {
  const [row] = await tx.select({ archivedAt: objects.archivedAt }).from(objects).where(eq(objects.id, objectId));
  if (row === undefined) throw refuse('NOT_FOUND', 'That object does not exist.');
  if (row.archivedAt !== null) throw refuse('NOT_FOUND', 'That object is archived. Restore it first.');
}

/**
 * Emails the member who started an import how it ended (#30, late trap #74), in the transaction that ends its job:
 * its counts and its summary page. Before, only a toast told them, and only while they had the app open. Nothing for
 * a starter who can no longer read the object (an import ended by losing access says nothing of it: hidden means
 * absent) or is no longer a member.
 */
async function tellStarter(
  context: WriteContext,
  rules: RuleSource | undefined,
  importId: string,
  outcome: 'done' | 'failed',
): Promise<void> {
  // No rules to read the starter with (a registry built with none): tell nothing rather than read them with none.
  if (rules === undefined) return;
  const { tx, scope } = context;
  const { workspaceId } = scope;
  const found = await tx.execute<{
    file_name: string;
    error_rows: number;
    starter: string;
    object_id: string;
    plural_name: string;
    api_slug: string;
    slug: string;
  }>(sql`
    select i.file_name, i.error_rows, i.created_by_member_id::text as starter, i.object_id::text, o.plural_name,
      o.api_slug, w.slug
    from imports i
    join objects o on o.workspace_id = i.workspace_id and o.id = i.object_id
    join workspaces w on w.id = i.workspace_id
    where i.workspace_id = ${workspaceId} and i.id = ${importId}
  `);
  const row = found.rows[0];
  if (row === undefined) return;
  const starter = await memberScopeIn(tx, scope, rules, row.starter);
  if (starter === undefined || objectLevel(starter.access, row.object_id) === 'none') return;
  const counts = await countRows(tx, workspaceId, importId);
  await queueImportFinished(tx, {
    importId,
    memberId: row.starter,
    params: {
      objectName: row.plural_name,
      // A file's name may run to 255 characters; an email's line holds 200.
      fileName: row.file_name.slice(0, 200),
      outcome,
      created: counts.created,
      updated: counts.updated,
      skipped: counts.skipped,
      failed: counts.refused + row.error_rows,
      resultPath: `/w/${encodeURIComponent(row.slug)}/objects/${encodeURIComponent(row.api_slug)}/imports/${importId}`,
    },
  });
}

/** The import kind; `rules` are the ones its starter is read with when it tells them how it ended. */
export function recordsImport(rules?: RuleSource): KindDefinition<ImportJobParams> {
  return defineKind<ImportJobParams>({
    kind: RECORDS_IMPORT,
    lane: 'heavy',
    actor: 'member',
    mode: 'items',
    params: ImportJobParams,
    cancellable: true,
    maxAttempts: MAX_ATTEMPTS.heavy,
    batchSize: IMPORT_BATCH,
    sample: { importId: '0192f1a4-0000-7000-8000-000000000001' },
    tellsStarter: true,
    async onSucceeded(context, job) {
      await tellStarter(context, rules, job.params.importId, 'done');
    },
    async onFailed(context, job) {
      // A removed starter isn't told about the job their removal ended.
      if (job.params === undefined || job.error.code === 'ACTOR_REMOVED') return;
      await tellStarter(context, rules, job.params.importId, 'failed');
    },
    async step(context, { job, items = [] }) {
      const { tx, scope } = context;
      const plan = await loadPlan(tx, scope, job.params.importId);
      if (plan === undefined) {
        return { finished: true, items: items.map((item) => ({ position: item.position, state: 'skipped' })) };
      }
      const found = await tx.execute<StagedRow>(sql`
        select id::text, row_number, "values", match_keys, outcome::text from import_rows
        where workspace_id = ${scope.workspaceId} and import_id = ${plan.importId}
          and id = any(array(select jsonb_array_elements_text(${JSON.stringify(items.map((item) => item.itemId))}::jsonb))::uuid[])
      `);
      const byId = new Map(found.rows.map((row) => [row.id, row]));
      const pending = found.rows.filter((row) => row.outcome === 'pending');
      // Once a batch, not once a row: the object still writable and live (a refusal ends the import with its
      // words), every match key's lock, the records they name, and the room under the record limit.
      try {
        await checkObject(tx, scope.access, plan.objectId, 'write');
        await liveImportObject(tx, plan.objectId);
        // The columns again, as the member stands now: a field gone hidden or read only ends the import.
        checkSettings(scope, plan.settings, new Map([...plan.attributes, ...plan.listAttributes]));
      } catch (error) {
        if (!isRefusal(error) || error.refusal.code === 'QUERY_CANCELLED') throw error;
        return { finished: false, failed: { code: error.refusal.code, message: error.refusal.message } };
      }
      const keys = pending.flatMap((row) => row.match_keys);
      await lockKeys(tx, plan, keys);
      const matches =
        plan.settings.matchAttributeId === undefined
          ? new Map<string, string>()
          : new Map(await readableMatches(tx, scope, plan.objectId, plan.settings.matchAttributeId, keys));
      const batch: BatchState = {
        matches,
        resolved: await resolveBatch(tx, scope, plan, pending),
        makes: await writableMakes(tx, scope, plan),
        room: await recordRoom(tx, scope),
        created: 0,
        stored: [],
      };
      const outcomes: ItemOutcome[] = [];
      for (const item of items) {
        const row = byId.get(item.itemId);
        // Gone, or decided by an earlier try whose batch committed: nothing to write again.
        if (row === undefined || row.outcome !== 'pending') {
          outcomes.push({ position: item.position, state: row?.outcome === 'refused' ? 'refused' : 'skipped' });
          continue;
        }
        const result = await context.perRecord((inner) => importRowInto(inner, plan, row, batch));
        if (result.ok) {
          batch.stored.push(result.value.stored);
          // Far records this row made: later rows link them, and they count against the record limit.
          for (const [key, link] of result.value.made) {
            const split = key.indexOf(':');
            const attributeId = key.slice(0, split);
            const names = batch.resolved.get(attributeId) ?? new Map<string, Resolved>();
            names.set(key.slice(split + 1), { ok: true, ...link });
            batch.resolved.set(attributeId, names);
            batch.room -= 1;
            batch.created += 1;
          }
          if (result.value.result.outcome === 'created' && result.value.stored.record_id !== undefined) {
            // Later rows of this batch sharing a key act on the record this one made.
            for (const key of row.match_keys) batch.matches.set(key, result.value.stored.record_id);
            batch.room -= 1;
            batch.created += 1;
          }
          outcomes.push({
            position: item.position,
            state: result.value.result.outcome === 'skipped' ? 'skipped' : 'done',
          });
          continue;
        }
        const { code, message } = refusalText(result.refusals);
        batch.stored.push({ row_number: row.row_number, outcome: 'refused', error_code: code, error_message: message });
        outcomes.push({ position: item.position, state: 'refused', code, message });
      }
      await storeOutcomes(tx, scope, plan.importId, batch.stored);
      // The batch's record slots, taken last as every write takes the counter row.
      if (batch.created > 0) await takeRecordSlots(tx, scope, batch.created);
      return { finished: false, items: outcomes, result: { importId: plan.importId, fileName: plan.fileName } };
    },
  });
}
