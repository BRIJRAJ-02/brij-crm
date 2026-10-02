// Reordering by drop target and by a step, as the reorderable lists do.
import { describe, expect, it } from 'vitest';
import { moveBy, reorder } from './reorder.ts';

const ids = ['a', 'b', 'c', 'd'];
const same = (id: string) => id;

describe('reorder', () => {
  it('places the moved items before or after the target, in their order', () => {
    expect(reorder(ids, same, new Set(['d']), 'a', 'before')).toEqual(['d', 'a', 'b', 'c']);
    expect(reorder(ids, same, new Set(['a', 'c']), 'd', 'after')).toEqual(['b', 'd', 'a', 'c']);
  });

  it('leaves the list when the target is moving or unknown', () => {
    expect(reorder(ids, same, new Set(['b']), 'b', 'before')).toBe(ids);
    expect(reorder(ids, same, new Set(['b']), 'z', 'before')).toBe(ids);
  });

  it('steps an item one place, stopping at the ends', () => {
    expect(moveBy(ids, 1, -1)).toEqual(['b', 'a', 'c', 'd']);
    expect(moveBy(ids, 3, 1)).toBe(ids);
  });
});
