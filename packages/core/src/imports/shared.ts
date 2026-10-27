// What the import services and its two jobs share (spec 0040): reading one
// import as a caller may see it, its counts by outcome, the view the page
// shows, and the checks on its settings against the object's attributes.
import { and, eq, sql } from 'drizzle-orm';
import {
  ImportSettings,
  isFinishedJob,
  PERMISSIONS,
  SYSTEM_ONLY_TYPES,
  type AttributeType,
  type ImportCounts,
  type ImportView,
} from '@crm/contracts';
import { BY_MEMBER, isUnfillableRequired } from '@crm/contracts/values';
import { schema, type WorkspaceTx } from '@crm/db';
import { can, objectLevel } from '../access/policy.ts';
import { attributeLevel, attributeVisible } from '../access/visibility.ts';
import { checkId } from '../engine/ids.ts';
import { refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { UNIQUE_TYPES } from '../engine/unique.ts';
import { isArchivedNow, type AttributeDef } from '../engine/values.ts';
import { isOpen } from '../access/policy.ts';

const { imports, jobs } = schema;

/** What NOT_FOUND says for an import: the same for one that doesn't exist and one the caller may not see. */
export const IMPORT_NOT_FOUND = "That import doesn't exist, or you can't see it.";

/** An import row as the services read it. */
export type ImportRow = typeof imports.$inferSelect;

/** The member id the scope acts as, or undefined for the system or a key. */
export const memberOf = (scope: EngineScope): string | undefined =>
  scope.actor.type === 'member' && scope.actor.id !== null ? scope.actor.id : undefined;

/** Whether the scope may see an import (and undo it): its starter, or a holder of `jobs.manage`. */
export function maySee(scope: EngineScope, row: Pick<ImportRow, 'createdByMemberId'>): boolean {
  return memberOf(scope) === row.createdByMemberId || can(scope.access, 'jobs.manage');
}

/**
 * Reads one import, refusing NOT_FOUND for a bad id, a missing import and
 * one the caller can't see; `starterOnly` lets in the starter alone (staging
 * and starting), and `lock` takes the row (`share` for staging, `update` to
 * start or undo).
 */
export async function readImport(
  tx: WorkspaceTx,
  scope: EngineScope,
  importId: string,
  options: { readonly lock?: 'share' | 'update'; readonly starterOnly?: boolean } = {},
): Promise<ImportRow> {
  const id = checkId(importId, IMPORT_NOT_FOUND);
  const query = tx
    .select()
    .from(imports)
    .where(and(eq(imports.workspaceId, scope.workspaceId), eq(imports.id, id)));
  const [row] = options.lock === undefined ? await query : await query.for(options.lock);
  const allowed =
    row !== undefined &&
    (options.starterOnly === true ? memberOf(scope) === row.createdByMemberId : maySee(scope, row));
  if (row === undefined || !allowed) throw refuse('NOT_FOUND', IMPORT_NOT_FOUND);
  // Hidden means absent: an import of an object the caller can't read is NOT_FOUND, for jobs.manage and a starter
  // who has lost access alike (its headers, counts and refusals quote the file).
  if (objectLevel(scope.access, row.objectId) === 'none' && !isOpen(scope.access)) {
    throw refuse('NOT_FOUND', IMPORT_NOT_FOUND);
  }
  return row;
}

/** An import's staged rows by outcome, in one grouped read (the outcome index). */
export async function countRows(tx: WorkspaceTx, workspaceId: string, importId: string): Promise<ImportCounts> {
  const result = await tx.execute<{ outcome: string; n: number; made: number }>(sql`
    select outcome::text as outcome, count(*)::int as n,
      coalesce(sum(jsonb_array_length(coalesce(made, '[]'::jsonb))), 0)::int as made
    from import_rows
    where workspace_id = ${workspaceId} and import_id = ${importId}
    group by outcome
  `);
  const of = (outcome: string) => result.rows.find((row) => row.outcome === outcome)?.n ?? 0;
  const counts = {
    pending: of('pending'),
    created: of('created'),
    updated: of('updated'),
    skipped: of('skipped'),
    refused: of('refused'),
    undone: of('undone'),
  };
  // Far records made by rows still standing (an undone row's went to the trash with it).
  const made = result.rows.filter((row) => row.outcome !== 'undone').reduce((sum, row) => sum + row.made, 0);
  return { staged: Object.values(counts).reduce((sum, n) => sum + n, 0), ...counts, made };
}

/** Whether a job (by id) has finished: missing counts as finished, since nothing of it can run. */
export async function jobFinished(tx: WorkspaceTx, workspaceId: string, jobId: string | null): Promise<boolean> {
  if (jobId === null) return true;
  const [row] = await tx
    .select({ status: jobs.status })
    .from(jobs)
    .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.id, jobId)));
  return row === undefined || isFinishedJob(row.status);
}

/** Whether an undo job ended without finishing its work (failed or cancelled): its import can be undone again. */
export async function undoFailed(tx: WorkspaceTx, workspaceId: string, jobId: string | null): Promise<boolean> {
  if (jobId === null) return false;
  const [row] = await tx
    .select({ status: jobs.status })
    .from(jobs)
    .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.id, jobId)));
  return row?.status === 'failed' || row?.status === 'cancelled';
}

/** Why undo can't run now, or undefined when it can (AC-1128, AC-1129). */
export async function undoRefusal(
  tx: WorkspaceTx,
  scope: EngineScope,
  row: ImportRow,
): Promise<{ readonly code: 'IMPORT_RUNNING' | 'IMPORT_UNDO_CLOSED'; readonly message: string } | undefined> {
  if (row.status === 'staging') return { code: 'IMPORT_RUNNING', message: 'This import hasn’t started yet.' };
  if (row.undoUntil === null || row.undoUntil.getTime() <= Date.now()) {
    return { code: 'IMPORT_UNDO_CLOSED', message: 'Undo closes 7 days after an import starts, and this one’s has.' };
  }
  if (!(await jobFinished(tx, scope.workspaceId, row.jobId))) {
    return { code: 'IMPORT_RUNNING', message: 'This import is still running. Cancel it first, then undo it.' };
  }
  return undefined;
}

/** The import as its page shows it, for a caller allowed to see it. */
export async function importView(tx: WorkspaceTx, scope: EngineScope, row: ImportRow): Promise<ImportView> {
  const counts = await countRows(tx, scope.workspaceId, row.id);
  const settings = ImportSettings.safeParse(row.settings);
  const undoable =
    (row.status === 'started' && row.undoJobId === null) ||
    (row.status === 'undone' && (await undoFailed(tx, scope.workspaceId, row.undoJobId)));
  const canUndo =
    undoable && counts.created + counts.updated + counts.made > 0 && (await undoRefusal(tx, scope, row)) === undefined;
  return {
    id: row.id,
    objectId: row.objectId,
    fileName: row.fileName,
    rowCount: row.rowCount,
    errorRows: row.errorRows,
    // Stored only after it parsed at create, so this always succeeds; an empty column list never shows.
    settings: settings.success ? settings.data : { columns: [{ header: '' }], onMatch: 'fill', onNoMatch: 'create' },
    status: row.status,
    counts,
    ...(row.jobId === null ? {} : { jobId: row.jobId }),
    ...(row.undoJobId === null ? {} : { undoJobId: row.undoJobId }),
    ...(row.undoUntil === null ? {} : { undoUntil: row.undoUntil.toISOString() }),
    canUndo,
    startedBy: row.createdByMemberId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Whether an attribute is one an import may write: live, not system, not system only, and writable by the scope. */
export function importable(scope: EngineScope, attribute: AttributeDef): boolean {
  if (attribute.isSystem || isArchivedNow(attribute)) return false;
  if ((SYSTEM_ONLY_TYPES as readonly AttributeType[]).includes(attribute.type)) return false;
  if (attribute.type === 'file') return false;
  // A relation column links names to far records (decision 7); one with no relationship has nowhere to link.
  if (attribute.type === 'record_reference' && attribute.relationshipId === null) return false;
  return isOpen(scope.access) || attributeLevel(scope.access, attribute) === 'write';
}

/**
 * Checks an import's settings against its object (AC-1138): every column's
 * attribute is the object's and one the member may write, a part only on a
 * personal name, no attribute taken twice, and a match attribute that is
 * unique and matched whole by a column. Refuses CONFIG_INVALID with why.
 */
export function checkSettings(
  scope: EngineScope,
  settings: ImportSettings,
  attributes: ReadonlyMap<string, AttributeDef>,
): void {
  const taken = new Set<string>();
  const whole = new Set<string>();
  /** Every attribute a column fills, by part or whole: what a required field needs one of. */
  const mapped = new Set<string>();
  for (const column of settings.columns) {
    const target = column.target;
    if (target === undefined) continue;
    const attribute = attributes.get(target.attributeId);
    if (attribute === undefined || !importable(scope, attribute)) {
      throw refuse('CONFIG_INVALID', `The column “${column.header}” goes to an attribute you can’t import into.`);
    }
    if (target.part !== undefined && attribute.type !== 'personal_name') {
      throw refuse('CONFIG_INVALID', `Only a name takes a first or last name column.`);
    }
    if (target.createMissing === true && attribute.type !== 'record_reference') {
      throw refuse('CONFIG_INVALID', `Only a relationship column makes missing records.`);
    }
    const key = `${target.attributeId}:${target.part ?? 'whole'}`;
    const clash =
      taken.has(key) ||
      (target.part === undefined ? taken.has(`${target.attributeId}:part`) : whole.has(target.attributeId));
    if (clash)
      throw refuse('CONFIG_INVALID', `${attribute.title} takes one column. Choose another for “${column.header}”.`);
    taken.add(key);
    mapped.add(target.attributeId);
    if (target.part === undefined) whole.add(target.attributeId);
    else taken.add(`${target.attributeId}:part`);
  }
  if (taken.size === 0) throw refuse('CONFIG_INVALID', 'Match at least one column to an attribute.');
  // An import that makes records hits the same wall a form's publish refuses (27 October 2026): a required field
  // nothing fills would refuse every new row, after the whole file was uploaded and mapped.
  if (settings.onNoMatch === 'create') checkRequiredColumns(scope, attributes, mapped);
  if (settings.matchAttributeId !== undefined) {
    const match = attributes.get(settings.matchAttributeId);
    if (match === undefined || !match.isUnique || !UNIQUE_TYPES.includes(match.type) || !whole.has(match.id)) {
      throw refuse('CONFIG_INVALID', 'Find records by a unique attribute that a column is matched to.');
    }
  }
}

/**
 * Refuses an import that would create records onto an object with a required
 * field nothing fills and no column matched to it (27 October 2026): every
 * new row would fail the same way, so it is said once, before the run, rather
 * than row by row afterwards. A member runs an import, so a Current user
 * default does fill itself here (`BY_MEMBER`). A field hidden from them is
 * counted but never named (spec 0009, AC-144).
 */
function checkRequiredColumns(
  scope: EngineScope,
  attributes: ReadonlyMap<string, AttributeDef>,
  mapped: ReadonlySet<string>,
): void {
  const walls = [...attributes.values()].filter(
    (attribute) => !isArchivedNow(attribute) && !mapped.has(attribute.id) && isUnfillableRequired(attribute, BY_MEMBER),
  );
  if (walls.length === 0) return;
  const named = walls
    .filter((attribute) => attributeVisible(scope.access, attribute))
    .map((attribute) => attribute.title);
  const hidden = walls.length - named.length;
  const subjects = [
    ...named,
    ...(hidden === 0 ? [] : [hidden === 1 ? 'one field you can’t see' : `${String(hidden)} fields you can’t see`]),
  ];
  const one = subjects.length === 1;
  const subject = one
    ? (subjects[0] ?? '')
    : `${subjects.slice(0, -1).join(', ')} and ${subjects[subjects.length - 1] ?? ''}`;
  const fix =
    named.length === 0
      ? `Ask a workspace admin to give ${one ? 'it a default' : 'them defaults'} or make ${one ? 'it' : 'them'} optional.`
      : `Match a column to ${one ? 'it' : 'them'}, or give ${one ? 'it a default' : 'them defaults'}.`;
  throw refuse(
    'CONFIG_INVALID',
    `${subject} ${one ? 'is' : 'are'} required, and no column fills ${one ? 'it' : 'them'}, so no new record could be made. ${fix}`,
  );
}

/** The permission message for undoing someone else's import, kept with the others. */
export const JOBS_MANAGE_MESSAGE = PERMISSIONS['jobs.manage'].message;
