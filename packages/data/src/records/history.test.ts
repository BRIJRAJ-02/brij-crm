// The undo stack's grouping (the CRM flow pass, 31 October 2026): the edits of one bulk Apply, one entry per field,
// share a group, and `popGroup` takes the rest of that Apply off the top, newest first, stopping at anything else.
import { describe, expect, it } from 'vitest';
import { createUndoStack, type CellsEntry, type UndoEntry } from './history.ts';

const WS = 'acme';

const bulk = (id: string, group?: string): CellsEntry => ({
  id,
  kind: 'bulk',
  objectId: 'people',
  cells: [{ recordId: `r-${id}`, attributeId: 'city', before: null, writtenVersionId: `v-${id}` }],
  ...(group === undefined ? {} : { group }),
});

const ids = (entries: readonly UndoEntry[]) => entries.map((entry) => entry.id);

describe('popGroup', () => {
  it('takes the rest of one Apply off the top, newest first, and leaves what came before', () => {
    const stack = createUndoStack();
    stack.push(WS, bulk('before'));
    stack.push(WS, bulk('a1', 'apply'));
    stack.push(WS, bulk('a2', 'apply'));
    stack.push(WS, bulk('a3', 'apply'));
    expect(stack.pop(WS)?.id).toBe('a3');
    expect(ids(stack.popGroup(WS, 'apply'))).toEqual(['a2', 'a1']);
    expect(stack.top(WS)?.id).toBe('before');
    expect(stack.size(WS)).toBe(1);
  });

  it('stops at the first entry of another group, an ungrouped edit or another kind', () => {
    const stack = createUndoStack();
    stack.push(WS, bulk('old', 'apply'));
    stack.push(WS, { id: 'gone', kind: 'delete', objectId: 'people', batchId: 'b', count: 1 });
    stack.push(WS, bulk('o1', 'other'));
    stack.push(WS, bulk('n1', 'apply'));
    stack.push(WS, bulk('n2', 'apply'));
    stack.pop(WS);
    expect(ids(stack.popGroup(WS, 'apply'))).toEqual(['n1']);
    expect(ids(stack.popGroup(WS, 'apply'))).toEqual([]);
    expect(stack.top(WS)?.id).toBe('o1');
    expect(stack.size(WS)).toBe(3);
  });

  it('takes nothing from an empty stack or another workspace', () => {
    const stack = createUndoStack();
    expect(stack.popGroup(WS, 'apply')).toEqual([]);
    stack.push('other', bulk('x', 'apply'));
    expect(stack.popGroup(WS, 'apply')).toEqual([]);
    expect(stack.size('other')).toBe(1);
  });
});
