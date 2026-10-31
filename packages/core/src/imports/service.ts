// Imports, as services (spec 0040): creating one with its settings, staging
// the browser's ready rows in chunks (each row's match keys worked out here,
// and how many match a record the member can read), starting its job, reading
// it and its refused rows, and starting its undo. Every call is a member's,
// through the scope the door made: an import needs write on its object, and
// an import the caller didn't start (or, for reads and undo, without
// `jobs.manage`) is the same NOT_FOUND as one that doesn't exist.
import { and, eq, sql } from 'drizzle-orm';
import {
  IMPORT_MATCHES_PAGE,
  ImportSettings,
  type CreateImportInput,
  type ImportLinks,
  type ImportMatches,
  type ImportRows,
  type ImportView,
  type StagedRow,
  type StageResult,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { checkScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { checkObject, UNKNOWN_LIST, visibleRecords } from '../access/visibility.ts';
import { encodeValue } from '../engine/columns.ts';
import { canonicalId, checkId } from '../engine/ids.ts';
import { limitsOf } from '../engine/limits.ts';
import { isRefusal, refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { uniqueKeyOf } from '../engine/unique.ts';
import { loadAttributes, loadListAttributes, type AttributeDef } from '../engine/values.ts';
import { checkWritableList } from '../engine/lists.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import type { JobRegistry } from '../jobs/registry.ts';
import { startJob } from '../jobs/service.ts';
import { farObjects, foldName, resolveNames } from './links.ts';
import {
  checkSettings,
  IMPORT_NOT_FOUND,
  importView,
  memberOf,
  readImport,
  undoFailed,
  undoRefusal,
  importable,
  requiredWall,
} from './shared.ts';
import { parseAttributeInput } from '../engine/parse-value.ts';

const { importRows, imports, objects } = schema;

/** The import job's kind, and its undo's. */
export const RECORDS_IMPORT = 'records.import';
export const RECORDS_IMPORT_UNDO = 'records.import_undo';

/** How long undo stays open after a start (owner decision 3). */
export const UNDO_WINDOW = '7 days';

/** How long a staged import nobody started is kept before the cleanup deletes it (AC-1145). */
export const STAGING_KEPT = '24 hours';

/** The object an import goes into, live; NOT_FOUND for one that is missing, archived or hidden. */
async function liveObject(tx: WorkspaceTx, scope: EngineScope, objectId: string): Promise<string> {
  const id = checkId(objectId, 'That object does not exist.');
  await checkObject(tx, scope.access, id, 'write');
  const [row] = await tx.select({ archivedAt: objects.archivedAt }).from(objects).where(eq(objects.id, id));
  if (row === undefined || row.archivedAt !== null) throw refuse('NOT_FOUND', 'That object does not exist.');
  return id;
}

/**
 * Checks each relation column that makes missing records (`createMissing`):
 * its relationship ends at one object, live and writable by the member.
 * Refuses CONFIG_INVALID with why, so the page only offers what lands.
 */
async function checkMakes(
  tx: WorkspaceTx,
  scope: EngineScope,
  settings: ImportSettings,
  attributes: ReadonlyMap<string, AttributeDef>,
): Promise<void> {
  for (const column of settings.columns) {
    if (column.target?.createMissing !== true) continue;
    const attribute = attributes.get(column.target.attributeId);
    const ends = attribute === undefined ? [] : await farObjects(tx, attribute);
    const [only] = ends;
    const why = `The column “${column.header}” can’t make missing records. Turn that off, or match it elsewhere.`;
    if (only === undefined || ends.length > 1) throw refuse('CONFIG_INVALID', why);
    try {
      await liveObject(tx, scope, only.objectId);
    } catch (error) {
      if (isRefusal(error)) throw refuse('CONFIG_INVALID', why);
      throw error;
    }
    // A record made for a name starts with that name, and its unique email or domain when the name is one
    // (`madeValues`): a required field past those refused every made record, row by row (late trap #75).
    const far = await loadAttributes(tx, only.objectId);
    const filled = new Set([
      ...(only.nameAttributeId === undefined ? [] : [only.nameAttributeId]),
      ...[...far.values()]
        .filter((each) => each.isUnique && (each.type === 'email' || each.type === 'domain'))
        .map((each) => each.id),
    ]);
    const wall = requiredWall(scope, far, filled);
    if (wall !== undefined) {
      const { subject, one } = wall;
      throw refuse(
        'CONFIG_INVALID',
        `The column “${column.header}” can’t make missing records: ${subject} ${one ? 'is' : 'are'} required there, ` +
          `and a record made for a name starts with only its name. Turn Create missing off, or ${
            wall.anyNamed ? `give ${one ? 'it a default' : 'them defaults'}` : 'ask a workspace admin for defaults'
          }.`,
      );
    }
  }
}

/**
 * Says which of a relation column's names link to no record before the
 * import starts (the preview's unmatched count): only records the member can
 * read are found, so nothing is revealed that the import itself wouldn't.
 * The column's attribute must be one the member may import into. Read only.
 */
export async function checkImportLinks(
  scope: EngineScope,
  input: { readonly objectId: string; readonly attributeId: string; readonly names: readonly string[] },
): Promise<ImportLinks> {
  checkScope(scope);
  if (input.names.length > 1_000) throw refuse('CONFIG_INVALID', 'Ask about at most 1,000 names at a time.');
  return inWorkspace(scope, async (tx) => {
    const objectId = await liveObject(tx, scope, input.objectId);
    const attributes = await loadAttributes(tx, objectId);
    const attribute = attributes.get(canonicalId(input.attributeId));
    if (attribute === undefined || !importable(scope, attribute)) {
      throw refuse('NOT_FOUND', 'That attribute does not exist.');
    }
    if (attribute.type !== 'record_reference') throw refuse('CONFIG_INVALID', `${attribute.title} links no records.`);
    const resolved = await resolveNames(tx, scope, await farObjects(tx, attribute), input.names);
    const missing: string[] = [];
    const ambiguous: string[] = [];
    const asked = new Map(input.names.map((name) => [foldName(name), name.trim()]));
    for (const [fold, each] of resolved) {
      const name = asked.get(fold) ?? fold;
      if (each.ok) continue;
      if (each.missing) missing.push(name);
      else ambiguous.push(name);
    }
    return { missing, ambiguous };
  });
}

/**
 * Says which of a file's ready rows would update a record before the import
 * starts (the preview's "X new, Y update"): each value's keys on the match
 * attribute, worked out as staging does, and whether one names a live
 * record the member can read. One read through the unique index for the
 * whole call, then the record rule, so nothing is revealed that the import
 * itself wouldn't. Write on the object, as only an importer asks. Read only.
 */
export async function checkImportMatches(
  scope: EngineScope,
  input: { readonly objectId: string; readonly attributeId: string; readonly values: readonly unknown[] },
): Promise<ImportMatches> {
  checkScope(scope);
  if (input.values.length > IMPORT_MATCHES_PAGE) {
    throw refuse('CONFIG_INVALID', `Ask about at most ${IMPORT_MATCHES_PAGE.toLocaleString('en')} values at a time.`);
  }
  return inWorkspace(scope, async (tx) => {
    const objectId = await liveObject(tx, scope, input.objectId);
    const attributes = await loadAttributes(tx, objectId);
    const attribute = attributes.get(canonicalId(input.attributeId));
    if (attribute === undefined || !importable(scope, attribute)) {
      throw refuse('NOT_FOUND', 'That attribute does not exist.');
    }
    if (!attribute.isUnique) throw refuse('CONFIG_INVALID', `${attribute.title} isn’t unique, so it finds no records.`);
    const keyed = input.values.map((value) => matchKeysOf(attribute, { [attribute.id]: value }));
    const found = await readableMatches(tx, scope, objectId, attribute.id, [...new Set(keyed.flat())]);
    return { rows: keyed.map((keys) => ({ keys, matched: keys.some((key) => found.has(key)) })) };
  });
}

/** How many imports the workspace has unfinished: staged ones still kept, and started ones whose job runs. */
async function unfinishedImports(tx: WorkspaceTx, workspaceId: string, besides: string): Promise<number> {
  const result = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from imports i
    left join jobs j on j.workspace_id = i.workspace_id and j.id = i.job_id
    where i.workspace_id = ${workspaceId} and i.id <> ${besides}
      and ((i.status = 'staging' and i.created_at > now() - ${STAGING_KEPT}::interval)
        or (i.status = 'started' and j.finished_at is null and j.id is not null))
  `);
  return result.rows[0]?.n ?? 0;
}

/**
 * Creates an import (AC-1123, AC-1136, AC-1138): write on the object, its
 * settings checked against the object's attributes, at most 3 unfinished
 * per workspace. Creating again with the same id answers the import already
 * made (a retry); an id that names someone else's is NOT_FOUND.
 */
export async function createImport(
  scope: EngineScope,
  input: Omit<CreateImportInput, 'workspace' | 'mutationId'>,
  hooks: readonly AfterWrite[] = [],
): Promise<ImportView> {
  checkScope(scope);
  const starter = memberOf(scope);
  if (starter === undefined) throw refuse('FORBIDDEN', 'Only a member can import.');
  const settings = ImportSettings.parse(input.settings);
  if (input.errorRows > input.rowCount) throw refuse('CONFIG_INVALID', 'A file has no more error rows than rows.');
  const id = checkId(input.id, IMPORT_NOT_FOUND);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const [existing] = await tx
        .select()
        .from(imports)
        .where(and(eq(imports.workspaceId, scope.workspaceId), eq(imports.id, id)));
      if (existing !== undefined) {
        if (existing.createdByMemberId !== starter) throw refuse('NOT_FOUND', IMPORT_NOT_FOUND);
        return importView(tx, scope, await readImport(tx, scope, id, { starterOnly: true }));
      }
      const objectId = await liveObject(tx, scope, input.objectId);
      const attributes = await loadAttributes(tx, objectId);
      // Into a list (spec 0048, AC-4833): the list checked as an add checks it (hidden is unknown, read only 403,
      // archived NOT_FOUND), over this object; its fields take columns beside the object's.
      const listId = input.listId === undefined ? undefined : checkId(input.listId, UNKNOWN_LIST);
      const listAttributes =
        listId === undefined ? new Map<string, AttributeDef>() : await loadListAttributes(tx, listId);
      if (listId !== undefined) {
        const list = await checkWritableList(context, listId);
        if (list.objectId !== objectId) {
          throw refuse('CONFIG_INVALID', "That list holds another object's records.");
        }
      }
      checkSettings(scope, settings, new Map([...attributes, ...listAttributes]));
      await checkMakes(tx, scope, settings, attributes);
      const limit = limitsOf(scope).unfinishedImports;
      // One create at a time per workspace, so two at once can't both pass the cap.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`imports:${scope.workspaceId}`}, 0))`);
      if ((await unfinishedImports(tx, scope.workspaceId, id)) >= limit) {
        throw refuse(
          'LIMIT_REACHED',
          `This workspace already has ${String(limit)} imports under way. Wait for one to finish, then try again.`,
        );
      }
      if (input.rowCount > limitsOf(scope).importRows) {
        throw refuse(
          'LIMIT_REACHED',
          `Import at most ${limitsOf(scope).importRows.toLocaleString('en')} rows at a time.`,
        );
      }
      const [row] = await tx
        .insert(imports)
        .values({
          workspaceId: scope.workspaceId,
          id,
          objectId,
          ...(listId === undefined ? {} : { listId }),
          fileName: input.fileName.trim(),
          rowCount: input.rowCount,
          errorRows: input.errorRows,
          settings,
          createdByMemberId: starter,
        })
        .returning();
      if (row === undefined) throw new Error('The import was not created.');
      return importView(tx, scope, row);
    },
    hooks,
  );
  return result;
}

/** A row's normalised keys on the match attribute: none when it has no value there, or one that doesn't parse. */
export function matchKeysOf(attribute: AttributeDef | undefined, values: Readonly<Record<string, unknown>>): string[] {
  if (attribute === undefined || !Object.hasOwn(values, attribute.id)) return [];
  const parsed = parseAttributeInput(attribute, values[attribute.id]);
  if (!parsed.ok || parsed.value === null) return [];
  const keys = encodeValue(attribute.type, parsed.value).flatMap((item) => {
    const key = uniqueKeyOf(attribute.type, item);
    return key === null ? [] : [key];
  });
  return [...new Set(keys)];
}

/**
 * The live records of `objectId` holding any of `keys` on the match
 * attribute, kept to the ones the scope may read: key to record id. One
 * read through the unique index, then the record rule.
 */
export async function readableMatches(
  tx: WorkspaceTx,
  scope: EngineScope,
  objectId: string,
  attributeId: string,
  keys: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (keys.length === 0) return new Map();
  const found = await tx.execute<{ key: string; record_id: string }>(sql`
    select v.unique_key as key, v.record_id::text as record_id from "values" v
    join records r on r.workspace_id = v.workspace_id and r.id = v.record_id
    where v.workspace_id = ${scope.workspaceId} and v.attribute_id = ${attributeId}
      and v.unique_key = any(array(select jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb)))
      and v.active_until is null and r.object_id = ${objectId} and r.deleted_at is null
  `);
  const seen = await visibleRecords(
    tx,
    scope.access,
    found.rows.map((row) => ({ objectId, recordId: row.record_id })),
  );
  return new Map(found.rows.filter((row) => seen.has(row.record_id)).map((row) => [row.key, row.record_id]));
}

/**
 * Stages a chunk of ready rows (AC-1123, AC-1136, AC-1138): the starter's
 * import, still staging; at most 1,000 rows, each at most 64 KB and naming
 * only attributes its columns go to; never more rows than the file said.
 * A row sent again (the same row number) changes nothing. Answers the rows
 * stored and how many of the chunk match a record the member can read.
 */
export async function stageImportRows(
  scope: EngineScope,
  input: { readonly importId: string; readonly rows: readonly StagedRow[] },
  hooks: readonly AfterWrite[] = [],
): Promise<StageResult> {
  checkScope(scope);
  const limits = limitsOf(scope);
  if (input.rows.length > limits.stageRows) {
    throw refuse('CONFIG_INVALID', `Send at most ${limits.stageRows.toLocaleString('en')} rows at a time.`);
  }
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      const row = await readImport(tx, scope, input.importId, { lock: 'share', starterOnly: true });
      if (row.status !== 'staging')
        throw refuse('IMPORT_STARTED', 'This import has started, so it takes no more rows.');
      const settings = ImportSettings.parse(row.settings);
      const targets = new Set(
        settings.columns.flatMap((column) => (column.target === undefined ? [] : [column.target.attributeId])),
      );
      const attributes = await loadAttributes(tx, row.objectId);
      const match = settings.matchAttributeId === undefined ? undefined : attributes.get(settings.matchAttributeId);
      const staged = input.rows.map((each) => {
        if (each.rowNumber > row.rowCount + 1)
          throw refuse('CONFIG_INVALID', `Row ${String(each.rowNumber)} is past the end of the file.`);
        const values = Object.fromEntries(Object.entries(each.values).map(([id, value]) => [canonicalId(id), value]));
        for (const attributeId of Object.keys(values)) {
          if (!targets.has(attributeId)) {
            throw refuse('CONFIG_INVALID', `Row ${String(each.rowNumber)} names an attribute no column goes to.`);
          }
        }
        const text = JSON.stringify(values);
        if (Buffer.byteLength(text) > limits.stageRowBytes) {
          throw refuse('CONFIG_INVALID', `Row ${String(each.rowNumber)} is too large to import (64 KB at most).`);
        }
        return { rowNumber: each.rowNumber, values: text, keys: matchKeysOf(match, values) };
      });
      const payload = JSON.stringify(staged.map((each) => ({ n: each.rowNumber, v: each.values, k: each.keys })));
      const inserted = await tx.execute<{ n: number }>(sql`
        with given as (
          select n, v::jsonb as v, k from jsonb_to_recordset(${payload}::jsonb) as g(n int, v text, k text[])
        )
        insert into import_rows (workspace_id, import_id, row_number, "values", match_keys)
        select ${scope.workspaceId}::uuid, ${row.id}::uuid, n, v, coalesce(k, '{}') from given
        on conflict (workspace_id, import_id, row_number) do nothing
        returning row_number as n
      `);
      const [held] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(importRows)
        .where(and(eq(importRows.workspaceId, scope.workspaceId), eq(importRows.importId, row.id)));
      if ((held?.n ?? 0) > row.rowCount) {
        throw refuse('LIMIT_REACHED', 'This import has more rows than its file said. Start it again from the file.');
      }
      if (match === undefined) return { staged: inserted.rows.length, matched: 0 };
      const keys = [...new Set(staged.flatMap((each) => each.keys))];
      const found = await readableMatches(tx, scope, row.objectId, match.id, keys);
      const matched = staged.filter((each) => each.keys.some((key) => found.has(key))).length;
      return { staged: inserted.rows.length, matched };
    },
    hooks,
  );
  return result;
}

/**
 * Starts the import's job (AC-1123): the starter's import with rows staged;
 * its items are the rows in file order, its undo window opens now. Starting
 * again answers the import as it is (a retry).
 */
export async function startImport(
  scope: EngineScope,
  registry: JobRegistry,
  importId: string,
  hooks: readonly AfterWrite[] = [],
): Promise<ImportView> {
  checkScope(scope);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const row = await readImport(tx, scope, importId, { lock: 'update', starterOnly: true });
      if (row.status !== 'staging') return importView(tx, scope, row);
      // The object may have been archived, or the member's access changed, since the import was made.
      await liveObject(tx, scope, row.objectId);
      const settings = ImportSettings.parse(row.settings);
      const attributes = await loadAttributes(tx, row.objectId);
      // Into a list: still writable and live, its fields as the member stands now (spec 0048, AC-4833).
      if (row.listId !== null) await checkWritableList(context, row.listId);
      const listAttributes =
        row.listId === null ? new Map<string, AttributeDef>() : await loadListAttributes(tx, row.listId);
      checkSettings(scope, settings, new Map([...attributes, ...listAttributes]));
      await checkMakes(tx, scope, settings, attributes);
      const ids = await tx.execute<{ id: string }>(sql`
        select id::text from import_rows where workspace_id = ${scope.workspaceId} and import_id = ${row.id}
        order by row_number
      `);
      if (ids.rows.length === 0)
        throw refuse('CONFIG_INVALID', 'No rows are ready to import. Fix the file and try again.');
      const { jobId } = await startJob(context, registry, {
        kind: RECORDS_IMPORT,
        params: { importId: row.id },
        items: ids.rows.map((each) => each.id),
        subject: { type: 'object', id: row.objectId },
      });
      const [updated] = await tx
        .update(imports)
        .set({ status: 'started', jobId, undoUntil: sql`now() + ${UNDO_WINDOW}::interval`, updatedAt: sql`now()` })
        .where(and(eq(imports.workspaceId, scope.workspaceId), eq(imports.id, row.id)))
        .returning();
      if (updated === undefined) throw new Error('The import went away under its lock.');
      return importView(tx, scope, updated);
    },
    hooks,
  );
  return result;
}

/** Reads one import (AC-1127): the starter's, or any for a holder of `jobs.manage`. */
export async function getImport(scope: EngineScope, importId: string): Promise<ImportView> {
  checkScope(scope);
  return inWorkspace(scope, async (tx) => importView(tx, scope, await readImport(tx, scope, importId)));
}

/**
 * A page of an import's rows with something to say (AC-1127): refused rows,
 * and rows that landed with a note (a link to a record that wasn't found),
 * in file order after the row number `cursor`.
 */
export async function listImportRefusals(
  scope: EngineScope,
  input: { readonly importId: string; readonly cursor?: number; readonly limit?: number },
): Promise<ImportRows> {
  checkScope(scope);
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 200);
  return inWorkspace(scope, async (tx) => {
    const row = await readImport(tx, scope, input.importId);
    const found = await tx.execute<{ row_number: number; code: string | null; message: string | null }>(sql`
      select row_number, error_code as code, error_message as message from import_rows
      where workspace_id = ${scope.workspaceId} and import_id = ${row.id} and error_message is not null
        and row_number > ${input.cursor ?? 0}
      order by row_number limit ${limit + 1}
    `);
    const rows = found.rows.slice(0, limit).map((each) => ({
      rowNumber: each.row_number,
      code: each.code ?? 'NOTE',
      message: each.message ?? '',
    }));
    const last = rows.at(-1);
    return found.rows.length > limit && last !== undefined ? { rows, nextCursor: last.rowNumber } : { rows };
  });
}

/**
 * Starts the import's undo (AC-1128, AC-1129): the starter or `jobs.manage`,
 * once the import has finished, within its window; its items are the rows
 * that created or changed a record. Asking again answers the undo already
 * started.
 */
export async function undoImport(
  scope: EngineScope,
  registry: JobRegistry,
  importId: string,
  hooks: readonly AfterWrite[] = [],
): Promise<ImportView> {
  checkScope(scope);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const row = await readImport(tx, scope, importId, { lock: 'update' });
      // An undo under way answers itself; one that failed (access lost, the object archived) can start again, its
      // rows already taken back skipped.
      if (row.undoJobId !== null && !(await undoFailed(tx, scope.workspaceId, row.undoJobId))) {
        return importView(tx, scope, row);
      }
      // Undo writes as the caller: write on a live object, whoever started the import.
      await liveObject(tx, scope, row.objectId);
      const refusal = await undoRefusal(tx, scope, row);
      if (refusal !== undefined) throw refuse(refusal.code, refusal.message);
      const ids = await tx.execute<{ id: string }>(sql`
        select id::text from import_rows where workspace_id = ${scope.workspaceId} and import_id = ${row.id}
          and (outcome in ('created', 'updated') or made is not null)
        order by row_number
      `);
      if (ids.rows.length === 0)
        throw refuse('CONFIG_INVALID', 'This import created and changed nothing, so there is nothing to undo.');
      const { jobId } = await startJob(context, registry, {
        kind: RECORDS_IMPORT_UNDO,
        params: { importId: row.id },
        items: ids.rows.map((each) => each.id),
        subject: { type: 'object', id: row.objectId },
      });
      const [updated] = await tx
        .update(imports)
        .set({ status: 'undone', undoJobId: jobId, updatedAt: sql`now()` })
        .where(and(eq(imports.workspaceId, scope.workspaceId), eq(imports.id, row.id)))
        .returning();
      if (updated === undefined) throw new Error('The import went away under its lock.');
      return importView(tx, scope, updated);
    },
    hooks,
  );
  return result;
}
