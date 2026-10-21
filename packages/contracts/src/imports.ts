// Import and export (spec 0040): the shapes the import page, the API and the
// jobs share. The browser reads a CSV, turns each cell into a typed value with
// the field set's `fromText`, and stages the ready rows here in chunks; the
// `records.import` job writes them through the engine as the member. An export
// names a view (its saved query, or the unsaved one on screen) and the
// `records.export` job writes it as CSV for a download. Every procedure is on
// the member door, and an import or export the caller may not see answers the
// same NOT_FOUND as one that doesn't exist.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { ExportIdInput } from './forms/forms.ts';
import { TRANSFER_LIMITS } from './transfer-limits.ts';
import { FilterGroup } from './values/filters.ts';
import { SortRules } from './values/sorts.ts';
import { WorkspaceScoped } from './workspaces.ts';

export { TRANSFER_LIMITS } from './transfer-limits.ts';

/**
 * Where a column goes: an attribute, or one part of a personal name. For a
 * relationship attribute whose far end is one object, `createMissing` makes
 * a record of that object for each name that links to none (the member must
 * be able to write that object).
 */
export const ImportTarget = z.strictObject({
  attributeId: z.uuid(),
  part: z.enum(['first', 'last']).optional(),
  createMissing: z.boolean().optional(),
});
/** Where a column goes. */
export type ImportTarget = z.infer<typeof ImportTarget>;

/** One column of the file: its header, and where it goes (absent: Don't import). */
export const ImportColumn = z.strictObject({
  header: z.string().max(200),
  target: ImportTarget.optional(),
});
/** One column of the file. */
export type ImportColumn = z.infer<typeof ImportColumn>;

/** What a row matching an existing record does: fill its empty fields, overwrite with the file's values, or nothing. */
export const ImportOnMatch = z.enum(['fill', 'overwrite', 'skip']);
/** What a matching row does. */
export type ImportOnMatch = z.infer<typeof ImportOnMatch>;

/** What a row matching no record does. */
export const ImportOnNoMatch = z.enum(['create', 'skip']);
/** What a row matching no record does. */
export type ImportOnNoMatch = z.infer<typeof ImportOnNoMatch>;

/**
 * An import's settings: its columns in file order, the unique attribute rows
 * find their records by (absent: every row is new), and the two rules.
 */
export const ImportSettings = z.strictObject({
  columns: z.array(ImportColumn).min(1).max(TRANSFER_LIMITS.importColumns),
  matchAttributeId: z.uuid().optional(),
  onMatch: ImportOnMatch,
  onNoMatch: ImportOnNoMatch,
});
/** An import's settings. */
export type ImportSettings = z.infer<typeof ImportSettings>;

/**
 * Starts an import into one object: `id` is the browser's uuid v7 (the retry
 * key, and later the trash batch its undo deletes with), `rowCount` the
 * file's data rows, `errorRows` the ones the browser could not read.
 */
export const CreateImportInput = WorkspaceScoped.extend({
  id: z.uuid({ version: 'v7', message: 'The import id must be a UUID v7.' }),
  objectId: z.uuid(),
  fileName: z.string().trim().min(1).max(255),
  rowCount: z.number().int().min(1).max(TRANSFER_LIMITS.importRows),
  errorRows: z.number().int().min(0).max(TRANSFER_LIMITS.importRows),
  settings: ImportSettings,
  mutationId: z.uuid(),
});
/** An import to start. */
export type CreateImportInput = z.infer<typeof CreateImportInput>;

/**
 * One ready row: its line in the file (the first data row is 2) and its
 * values by attribute id, each in its type's shape, or `{ names }` for a
 * relationship attribute (the far records' names, matched by the job).
 */
export const StagedRow = z.strictObject({
  rowNumber: z
    .number()
    .int()
    .min(2)
    .max(TRANSFER_LIMITS.importRows + 1),
  values: z.record(z.uuid(), z.unknown()),
});
/** One ready row. */
export type StagedRow = z.infer<typeof StagedRow>;

/** A chunk of ready rows, in file order. Sending one again changes nothing. */
export const StageImportInput = WorkspaceScoped.extend({
  importId: z.uuid(),
  rows: z.array(StagedRow).min(1).max(TRANSFER_LIMITS.stageRows),
  mutationId: z.uuid(),
});
/** A chunk of ready rows. */
export type StageImportInput = z.infer<typeof StageImportInput>;

/** What a chunk did: the rows it stored, and how many of them match a record the member can read. */
export const StageResult = z.object({
  staged: z.number().int().min(0),
  matched: z.number().int().min(0),
});
/** What a chunk did. */
export type StageResult = z.infer<typeof StageResult>;

/** One import, by id. */
export const ImportInput = WorkspaceScoped.extend({ importId: z.uuid() });
/** One import, by id. */
export type ImportInput = z.infer<typeof ImportInput>;

/** A change to one import (start, undo), with the browser's id for the write. */
export const ImportWriteInput = ImportInput.extend({ mutationId: z.uuid() });
/** A change to one import. */
export type ImportWriteInput = z.infer<typeof ImportWriteInput>;

/**
 * Names a relation column holds, to say before the import which link to no
 * record (AC-1121's preview): the import's object and the relationship
 * attribute, and at most 1,000 distinct names a call.
 */
export const ImportLinksInput = WorkspaceScoped.extend({
  objectId: z.uuid(),
  attributeId: z.uuid(),
  names: z.array(z.string().trim().min(1).max(500)).min(1).max(1_000),
});
/** Names a relation column holds. */
export type ImportLinksInput = z.infer<typeof ImportLinksInput>;

/** Of the names asked about: those that link to no record the member can read, and those that name several. */
export const ImportLinks = z.object({
  missing: z.array(z.string()),
  ambiguous: z.array(z.string()),
});
/** Names that link to no record, or to several. */
export type ImportLinks = z.infer<typeof ImportLinks>;

/** Where an import is: rows arriving, its job started, or taken back. */
export const ImportStatus = z.enum(['staging', 'started', 'undone']);
/** Where an import is. */
export type ImportStatus = z.infer<typeof ImportStatus>;

/** Staged rows by outcome. */
export const ImportCounts = z.object({
  staged: z.number().int().min(0),
  pending: z.number().int().min(0),
  created: z.number().int().min(0),
  updated: z.number().int().min(0),
  skipped: z.number().int().min(0),
  refused: z.number().int().min(0),
  undone: z.number().int().min(0),
  /** Records of a relation's far object the import made for names that linked to none (`createMissing`). */
  made: z.number().int().min(0),
});
/** Staged rows by outcome. */
export type ImportCounts = z.infer<typeof ImportCounts>;

/**
 * One import as its page shows it: its file and settings, where it is, its
 * rows by outcome, its job and its undo job, when undo closes, and whether
 * the caller may undo it now.
 */
export const ImportView = z.object({
  id: z.uuid(),
  objectId: z.uuid(),
  fileName: z.string(),
  rowCount: z.number().int().min(0),
  errorRows: z.number().int().min(0),
  settings: ImportSettings,
  status: ImportStatus,
  counts: ImportCounts,
  jobId: z.uuid().optional(),
  undoJobId: z.uuid().optional(),
  undoUntil: z.iso.datetime({ offset: true }).optional(),
  canUndo: z.boolean(),
  startedBy: z.uuid(),
  createdAt: z.iso.datetime({ offset: true }),
});
/** One import. */
export type ImportView = z.infer<typeof ImportView>;

/** The most refused rows one page of `imports.rows` holds. */
export const IMPORT_ROWS_PAGE = 200;

/** A page of an import's refused rows, after the row number `cursor`. */
export const ImportRowsInput = ImportInput.extend({
  cursor: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(IMPORT_ROWS_PAGE).optional(),
});
/** A page of refused rows to read. */
export type ImportRowsInput = z.infer<typeof ImportRowsInput>;

/** One refused row: its line in the file, and why. */
export const ImportRowRefusal = z.object({
  rowNumber: z.number().int().min(2),
  code: z.string(),
  message: z.string(),
});
/** One refused row. */
export type ImportRowRefusal = z.infer<typeof ImportRowRefusal>;

/** A page of refused rows, and the cursor for the next one when there is more. */
export const ImportRows = z.object({
  rows: z.array(ImportRowRefusal),
  nextCursor: z.number().int().optional(),
});
/** A page of refused rows. */
export type ImportRows = z.infer<typeof ImportRows>;

/**
 * Exports a view as CSV in the background: `id` is the browser's uuid v7
 * (the retry key); the view by id when saved, with the filter and sorts on
 * screen (the unsaved ones when the member changed them); `attributeIds` the
 * visible columns in order; `timeZone` for relative dates in the filter.
 */
export const StartExportInput = WorkspaceScoped.extend({
  id: z.uuid({ version: 'v7', message: 'The export id must be a UUID v7.' }),
  objectId: z.uuid(),
  viewId: z.uuid().optional(),
  filter: FilterGroup.optional(),
  sorts: SortRules.optional(),
  attributeIds: z.array(z.uuid()).min(1).max(TRANSFER_LIMITS.importColumns),
  timeZone: z.string().min(1).max(64),
  mutationId: z.uuid(),
});
/** An export to start. */
export type StartExportInput = z.infer<typeof StartExportInput>;

/**
 * One records export as the browser sees it (the shape of the forms'
 * `ExportView`, with its object): its file's name, its job (follow it through
 * `jobs`), its rows once written, when the file goes, and where to download
 * it once the job succeeded.
 */
export const RecordsExportView = z.object({
  id: z.uuid(),
  objectId: z.uuid(),
  fileName: z.string(),
  jobId: z.uuid(),
  rowCount: z.number().int().min(0).optional(),
  expiresAt: z.iso.datetime({ offset: true }),
  downloadPath: z.string(),
});
/** One records export. */
export type RecordsExportView = z.infer<typeof RecordsExportView>;

/**
 * Imports, on the member door. `create` needs write on the object; `stage`,
 * `start`, `get`, `rows` and `undo` the starter (and, for all but `stage`
 * and `start`, holders of `jobs.manage`). Refusals: `NOT_FOUND` for one the
 * caller may not see, `IMPORT_STARTED` for staging after the start,
 * `IMPORT_RUNNING` for an undo while it runs, `IMPORT_UNDO_CLOSED` past the
 * window, `LIMIT_REACHED` for a fourth unfinished import or more rows than
 * the file said.
 */
export const importsContract = {
  create: oc.input(CreateImportInput).output(ImportView),
  stage: oc.input(StageImportInput).output(StageResult),
  start: oc.input(ImportWriteInput).output(ImportView),
  get: oc.input(ImportInput).output(ImportView),
  rows: oc.input(ImportRowsInput).output(ImportRows),
  undo: oc.input(ImportWriteInput).output(ImportView),
  links: oc.input(ImportLinksInput).output(ImportLinks),
};

/**
 * Exports, on the member door. `start` needs read on the object (and the
 * view); `EXPORT_TOO_LARGE` past 100,000 rows. `get` is the starter's only.
 * The file itself is `GET /api/exports/<id>/download?workspace=<slug>`.
 */
export const exportsContract = {
  start: oc.input(StartExportInput).output(RecordsExportView),
  get: oc.input(ExportIdInput).output(RecordsExportView),
};
