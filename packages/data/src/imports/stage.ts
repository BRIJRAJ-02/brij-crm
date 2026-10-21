// Staging an import's ready rows (spec 0040): the rows go in file order, in
// chunks the API takes in one call. Pure; no network.
import type { StagedRow } from '@crm/contracts';
import { TRANSFER_LIMITS } from '@crm/contracts/transfer-limits';

/** The JSON bytes one row adds to a staging call, close enough to keep a call under its body limit. */
const rowBytes = (row: StagedRow): number => new TextEncoder().encode(JSON.stringify(row)).length + 1;

/**
 * Splits ready rows into staging chunks, in order: at most
 * `TRANSFER_LIMITS.stageRows` rows and `TRANSFER_LIMITS.stageBytes` of JSON
 * each. A row is never split, and every chunk holds at least one row.
 */
export function stageChunks(
  rows: readonly StagedRow[],
  limits: { readonly rows: number; readonly bytes: number } = {
    rows: TRANSFER_LIMITS.stageRows,
    bytes: TRANSFER_LIMITS.stageBytes,
  },
): readonly (readonly StagedRow[])[] {
  const chunks: StagedRow[][] = [];
  let current: StagedRow[] = [];
  let bytes = 0;
  for (const row of rows) {
    const size = rowBytes(row);
    if (current.length > 0 && (current.length >= limits.rows || bytes + size > limits.bytes)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(row);
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
