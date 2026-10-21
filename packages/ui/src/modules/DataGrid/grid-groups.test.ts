import { describe, expect, it } from 'vitest';
import { groupMap, type GridGroup } from './grid-groups.ts';

const group = (id: string, start: number, count: number, isCollapsed = false): GridGroup => ({
  id,
  title: id,
  start,
  count,
  isCollapsed,
});

describe('groupMap', () => {
  it('draws each row on its own line with no groups', () => {
    const map = groupMap([], 3);
    expect(map.size).toBe(3);
    expect([0, 1, 2].map(map.lineOf)).toEqual([0, 1, 2]);
    expect(map.at(1)).toEqual({ kind: 'row', row: 1 });
  });

  it('puts each header on the line before its first row', () => {
    // Lead: rows 0 and 1; Won: row 2.
    const map = groupMap([group('lead', 0, 2), group('won', 2, 1)], 3);
    expect(map.size).toBe(5);
    expect([0, 1, 2, 3, 4].map((line) => map.at(line))).toEqual([
      { kind: 'group', group: group('lead', 0, 2), index: 0 },
      { kind: 'row', row: 0 },
      { kind: 'row', row: 1 },
      { kind: 'group', group: group('won', 2, 1), index: 1 },
      { kind: 'row', row: 2 },
    ]);
    expect([0, 1, 2].map(map.lineOf)).toEqual([1, 2, 4]);
  });

  it('keeps a collapsed group as its header alone, at the next group’s start', () => {
    // Lead folded (its 5 rows left out of the source), then Won with rows 0 and 1, then Lost folded at the end.
    const map = groupMap([group('lead', 0, 5, true), group('won', 0, 2), group('lost', 2, 4, true)], 2);
    expect(map.size).toBe(5);
    expect(map.at(0)).toMatchObject({ kind: 'group', index: 0 });
    expect(map.at(1)).toMatchObject({ kind: 'group', index: 1 });
    expect(map.at(2)).toEqual({ kind: 'row', row: 0 });
    expect(map.at(3)).toEqual({ kind: 'row', row: 1 });
    expect(map.at(4)).toMatchObject({ kind: 'group', index: 2 });
    expect([0, 1].map(map.lineOf)).toEqual([2, 3]);
  });

  it('counts the rows before a line, for the range the screen loads', () => {
    const map = groupMap([group('lead', 0, 2), group('won', 2, 1)], 3);
    expect([0, 1, 2, 3, 4, 5].map(map.rowsBefore)).toEqual([0, 0, 1, 2, 2, 3]);
  });
});
