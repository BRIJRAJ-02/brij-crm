import { describe, expect, it } from 'vitest';
import type { StagedRow } from '@crm/contracts';
import { stageChunks } from './stage.ts';

const attribute = '0192a000-0000-7000-8000-000000000001';
const row = (n: number, text = 'x'): StagedRow => ({ rowNumber: n + 2, values: { [attribute]: text } });

describe('stageChunks', () => {
  it('keeps every row in file order, at most the row limit a chunk', () => {
    const rows = Array.from({ length: 2_500 }, (_, n) => row(n));
    const chunks = stageChunks(rows);
    expect(chunks.map((each) => each.length)).toEqual([1_000, 1_000, 500]);
    expect(chunks.flat().map((each) => each.rowNumber)).toEqual(rows.map((each) => each.rowNumber));
  });

  it('starts a new chunk before the byte limit, never splitting a row', () => {
    const rows = [row(0, 'a'.repeat(60)), row(1, 'b'.repeat(60)), row(2, 'c')];
    const chunks = stageChunks(rows, { rows: 1_000, bytes: 200 });
    expect(chunks.map((each) => each.length)).toEqual([1, 2]);
  });

  it('sends a row bigger than the byte limit alone, and nothing for no rows', () => {
    expect(stageChunks([row(0, 'a'.repeat(500))], { rows: 10, bytes: 100 })).toHaveLength(1);
    expect(stageChunks([])).toEqual([]);
  });
});
