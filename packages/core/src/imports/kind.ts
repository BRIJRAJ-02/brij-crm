// `records.import` (spec 0037, AC-1119, AC-1124 to AC-1126): an import's
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
import { insertRecord, readRecords, updateRecord } from '../engine/records.ts';
import type { EngineScope } from '../engine/scope.ts';
import { loadAttributes, type AttributeDef } from '../engine/values.ts';
import type { WriteContext } from '../engine/write.ts';
import { defineKind, MAX_ATTEMPTS, type ItemOutcome, type KindDefinition } from '../jobs/registry.ts';
import { farObjects, namesOf, resolveLinks, type FarObject } from './links.ts';
import { RECORDS_IMPORT, readableMatches } from './service.ts';

const { importRows, imports } = schema;

/** The kind's params: the import whose rows it writes. */
export const ImportJobParams = z.strictObject({ importId: z.uuid() });
/** The kind's params. */
export type ImportJobParams = z.infer<typeof ImportJobParams>;

/** Rows a batch writes: one transaction holding their locks and keys for under a second. */
export const IMPORT_BATCH = 100;

/** One staged row as the job reads it. */
interface StagedRow {
  readonly id: string;
  readonly row_number: number;
  readonly values: unknown;
  readonly match_keys: string[];
  readonly outcome: string;
}

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
    return added.length === 0 ? undefined : [...held, ...added];
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

/** Takes the match keys' locks in one order, so two imports of one new key meet in turn (two rows never both create). */
async function lockKeys(tx: WorkspaceTx, plan: ImportPlan, keys: readonly string[]): Promise<void> {
  const attributeId = plan.settings.matchAttributeId;
  if (attributeId === undefined) return;
  for (const key of [...keys].sort()) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`import-match:${plan.objectId}:${attributeId}:${key}`}, 0))`,
    );
  }
}

/** Writes one row inside its savepoint: matched, then created, updated or skipped by the rules, outcome stored. */
async function importRow(context: WriteContext, plan: ImportPlan, row: StagedRow): Promise<RowResult> {
  const { tx, scope } = context;
  const { settings } = plan;
  const { values, notes } = await rowValues(context, plan, row.values);
  const note = notes.length === 0 ? undefined : notes.slice(0, 3).join(' ');
  await lockKeys(tx, plan, row.match_keys);
  const matchId =
    settings.matchAttributeId === undefined || row.match_keys.length === 0
      ? undefined
      : [...(await readableMatches(tx, scope, plan.objectId, settings.matchAttributeId, row.match_keys)).values()][0];
  const store = (set: Record<string, unknown>) =>
    tx
      .update(importRows)
      .set({ ...set, errorCode: note === undefined ? null : 'LINK_NOT_FOUND', errorMessage: note ?? null })
      .where(
        and(
          eq(importRows.workspaceId, scope.workspaceId),
          eq(importRows.importId, plan.importId),
          eq(importRows.rowNumber, row.row_number),
        ),
      );

  if (matchId === undefined) {
    if (settings.onNoMatch === 'skip') {
      await store({ outcome: 'skipped' });
      return { outcome: 'skipped' };
    }
    const created = await insertRecord(context, { objectId: plan.objectId, values: Object.fromEntries(values) });
    await store({ outcome: 'created', recordId: created.recordId });
    return { outcome: 'created', ...(note === undefined ? {} : { note }) };
  }

  if (settings.onMatch === 'skip') {
    await store({ outcome: 'skipped', recordId: matchId });
    return { outcome: 'skipped' };
  }
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
  if (Object.keys(next).length === 0) {
    await store({ outcome: 'skipped', recordId: matchId });
    return { outcome: 'skipped' };
  }
  const results = await updateRecord(context, { recordId: matchId, values: next });
  const written = Object.fromEntries(
    Object.entries(results).flatMap(([id, result]) => (result.versionId === undefined ? [] : [[id, result.versionId]])),
  );
  if (Object.keys(written).length === 0) {
    await store({ outcome: 'skipped', recordId: matchId });
    return { outcome: 'skipped' };
  }
  const kept = Object.fromEntries(Object.entries(before).filter(([id]) => Object.hasOwn(written, id)));
  await store({ outcome: 'updated', recordId: matchId, before: kept, written });
  return { outcome: 'updated', ...(note === undefined ? {} : { note }) };
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
      const outcomes: ItemOutcome[] = [];
      for (const item of items) {
        const row = byId.get(item.itemId);
        // Gone, or decided by an earlier try whose batch committed: nothing to write again.
        if (row === undefined || row.outcome !== 'pending') {
          outcomes.push({ position: item.position, state: row?.outcome === 'refused' ? 'refused' : 'skipped' });
          continue;
        }
        const result = await context.perRecord((inner) => importRow(inner, plan, row));
        if (result.ok) {
          outcomes.push({ position: item.position, state: result.value.outcome === 'skipped' ? 'skipped' : 'done' });
          continue;
        }
        const { code, message } = refusalText(result.refusals);
        await tx
          .update(importRows)
          .set({ outcome: 'refused', errorCode: code, errorMessage: message })
          .where(
            and(
              eq(importRows.workspaceId, scope.workspaceId),
              eq(importRows.importId, plan.importId),
              eq(importRows.rowNumber, row.row_number),
            ),
          );
        outcomes.push({ position: item.position, state: 'refused', code, message });
      }
      return { finished: false, items: outcomes };
    },
  });
}
