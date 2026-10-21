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
// commit) is skipped, so no row is written twice.
import { and, eq, sql } from 'drizzle-orm';
import * as z from 'zod';
import { ImportSettings, type EngineRefusal } from '@crm/contracts';
import { parseAttributeValue } from '@crm/contracts/values';
import { schema, type WorkspaceTx } from '@crm/db';
import { canonicalId } from '../engine/ids.ts';
import { checkObject } from '../access/visibility.ts';
import { limitsOf, takeRecordSlots } from '../engine/limits.ts';
import { insertRecord, readRecords, updateRecord } from '../engine/records.ts';
import { isRefusal, refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { loadAttributes, type AttributeDef } from '../engine/values.ts';
import type { WriteContext } from '../engine/write.ts';
import { defineKind, MAX_ATTEMPTS, type ItemOutcome, type KindDefinition } from '../jobs/registry.ts';
import { farObjects, namesOf, resolveLinks, type FarObject } from './links.ts';
import { RECORDS_IMPORT, readableMatches } from './service.ts';
import { checkSettings } from './shared.ts';

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
  readonly settings: ImportSettings;
  readonly attributes: ReadonlyMap<string, AttributeDef>;
  readonly far: ReadonlyMap<string, readonly FarObject[]>;
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

/** A value's identity for comparing one item with another. */
const identity = (value: unknown): string => JSON.stringify(value);

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
  const parsed = parseAttributeValue(attribute.type, value, { allowMultiple: attribute.isMulti });
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
  for (const column of settings.columns) {
    const attribute = column.target === undefined ? undefined : attributes.get(column.target.attributeId);
    if (attribute?.type === 'record_reference' && !far.has(attribute.id)) {
      far.set(attribute.id, await farObjects(tx, attribute));
    }
  }
  return { importId: row.id, objectId: row.objectId, settings, attributes, far };
}

/** The row's values with relation names turned into links, and a note for each name left out. */
async function rowValues(
  context: WriteContext,
  plan: ImportPlan,
  staged: unknown,
): Promise<{ readonly values: Map<string, unknown>; readonly notes: readonly string[] }> {
  const given = typeof staged === 'object' && staged !== null ? (staged as Record<string, unknown>) : {};
  const values = new Map<string, unknown>();
  const notes: string[] = [];
  for (const [id, value] of Object.entries(given)) {
    const attributeId = canonicalId(id);
    const attribute = plan.attributes.get(attributeId);
    if (attribute === undefined) continue;
    if (attribute.type === 'record_reference') {
      const names = namesOf(value);
      if (names === undefined || names.length === 0) continue;
      const linked = await resolveLinks(context.tx, context.scope, attribute, plan.far.get(attributeId) ?? [], names);
      notes.push(...linked.notes);
      if (linked.value !== undefined) values.set(attributeId, linked.value);
      continue;
    }
    if (!isEmpty(value)) values.set(attributeId, value);
  }
  return { values, notes };
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
): Promise<{ readonly result: RowResult; readonly stored: StoredOutcome }> {
  const { tx, scope } = context;
  const { settings } = plan;
  const { values, notes } = await rowValues(context, plan, row.values);
  const note = notes.length === 0 ? undefined : notes.slice(0, 3).join(' ');
  const noted = note === undefined ? {} : { error_code: 'LINK_NOT_FOUND', error_message: note };
  const matchId =
    settings.matchAttributeId === undefined
      ? undefined
      : row.match_keys.map((key) => batch.matches.get(key)).find((id) => id !== undefined);
  const base = { row_number: row.row_number, ...noted };

  if (matchId === undefined) {
    if (settings.onNoMatch === 'skip')
      return { result: { outcome: 'skipped' }, stored: { ...base, outcome: 'skipped' } };
    // The record limit, counted for the batch: a row past it is refused as a create would be.
    if (batch.room <= 0)
      throw refuse(
        'LIMIT_REACHED',
        `This workspace holds at most ${limitsOf(scope).liveRecords.toLocaleString('en')} records.`,
      );
    const created = await insertRecord(
      context,
      { objectId: plan.objectId, values: Object.fromEntries(values) },
      { attributes: plan.attributes, countsSlots: true },
    );
    return {
      result: { outcome: 'created', ...(note === undefined ? {} : { note }) },
      stored: { ...base, outcome: 'created', record_id: created.recordId },
    };
  }

  const skipped = {
    result: { outcome: 'skipped' as const },
    stored: { ...base, outcome: 'skipped' as const, record_id: matchId },
  };
  if (settings.onMatch === 'skip') return skipped;
  const ids = [...values.keys()];
  const [current] = await readRecords(tx, scope.access, [matchId], { attributeIds: ids });
  const next: Record<string, { value: unknown }> = {};
  const before: Record<string, { value: unknown; versionId?: string }> = {};
  for (const [attributeId, value] of values) {
    const attribute = plan.attributes.get(attributeId);
    if (attribute === undefined) continue;
    // A link list cut short on read isn't whole, so writing it back would drop links: it is left as it is.
    if (current?.linkTotals[attributeId] !== undefined) continue;
    const held = current?.values[attributeId] ?? null;
    const merged = mergeValue(attribute, canonical(attribute, value), held, settings.onMatch);
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
      written = coalesce(v.written, r.written)
    from jsonb_to_recordset(${JSON.stringify(stored)}::jsonb) as v(
      row_number int, outcome text, record_id uuid, error_code text, error_message text, before jsonb, written jsonb
    )
    where r.workspace_id = ${scope.workspaceId} and r.import_id = ${importId} and r.row_number = v.row_number
  `);
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

/** The import kind. */
export function recordsImport(): KindDefinition<ImportJobParams> {
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
        checkSettings(scope, plan.settings, plan.attributes);
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
      const batch: BatchState = { matches, room: await recordRoom(tx, scope), created: 0, stored: [] };
      const outcomes: ItemOutcome[] = [];
      for (const item of items) {
        const row = byId.get(item.itemId);
        // Gone, or decided by an earlier try whose batch committed: nothing to write again.
        if (row === undefined || row.outcome !== 'pending') {
          outcomes.push({ position: item.position, state: row?.outcome === 'refused' ? 'refused' : 'skipped' });
          continue;
        }
        const result = await context.perRecord((inner) => importRow(inner, plan, row, batch));
        if (result.ok) {
          batch.stored.push(result.value.stored);
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
      return { finished: false, items: outcomes, result: { importId: plan.importId } };
    },
  });
}
