import { describe, expect, it } from 'vitest';
import { itemOfKey, keyedRows } from './keyed-rows.ts';
import type { ListSource } from './list-source.ts';

const source: ListSource<{ readonly id: string }> = {
  count: 3,
  getItem: (index) => (index === 1 ? undefined : { id: `t${String(index)}` }),
  getKey: (item) => item.id,
};

describe('keyedRows', () => {
  it('keys loaded rows by their item and the rest by place', () => {
    const rows = keyedRows(source);
    expect(rows.map((row) => row.index)).toEqual([0, 1, 2]);
    expect(rows[0]?.id).toBe('t0');
    expect(rows[2]?.id).toBe('t2');
    expect(rows[1]?.id).not.toBe('t1');
  });

  it('finds the item behind a key', () => {
    const rows = keyedRows(source);
    expect(itemOfKey(source, rows, 't2')).toEqual({ id: 't2' });
    expect(itemOfKey(source, rows, 'missing')).toBeUndefined();
  });
});
