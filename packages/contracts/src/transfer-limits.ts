// `@crm/contracts/transfer-limits` (spec 0040, decisions 4 and 5): the import
// and export limits, as plain numbers with no Zod, so the import page checks a
// file in the browser by the same numbers the server holds it to.

/**
 * What one file may hold (rows, columns, bytes), what one staging call
 * carries (rows, and bytes as JSON), one staged row's bytes, how many imports
 * a workspace may have unfinished, how long undo stays open, and how many rows
 * one export writes (spec 0023's `EXPORT_ROWS_MAX`, until files move to R2).
 * The engine's limits module takes its numbers from here.
 */
export const TRANSFER_LIMITS = {
  importRows: 100_000,
  importColumns: 250,
  importBytes: 50 * 1024 * 1024,
  stageRows: 1_000,
  /** One staging call's rows as JSON, at most: under the API's 1 MB body limit. */
  stageBytes: 900 * 1024,
  /** One staged row's values as JSON, at most. */
  stageRowBytes: 64 * 1024,
  unfinishedImports: 3,
  undoDays: 7,
  exportRows: 100_000,
  exportKeptDays: 7,
} as const;
