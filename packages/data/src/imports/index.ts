// `@crm/data/imports` (spec 0040): what the import page loads with itself,
// outside the first load: the CSV reader, the CSV writer (the error rows
// file) and the import limits. Pure; no network.
export {
  CSV_LIMITS,
  CSV_TYPES,
  decodeCsv,
  detectSeparator,
  isCsvName,
  parseCsv,
  readCsvFile,
  type CsvLimits,
  type CsvRefusal,
  type CsvResult,
  type CsvSeparator,
  type CsvTable,
} from './csv.ts';
/** CSV writing (RFC 4180, the formula guard): the error rows file the import page saves. */
export { CSV_BOM, csvLine, unguardCell } from '@crm/contracts/csv';
/** The import and export limits the server holds the page to. */
export { TRANSFER_LIMITS } from '@crm/contracts/transfer-limits';
