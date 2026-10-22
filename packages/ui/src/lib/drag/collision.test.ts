// The board's drop target rule (itemsFirst): a card over a column, by pointer or by keyboard.
import { describe, expect, it } from 'vitest';
import { itemsFirst } from './drag.tsx';

type Args = Parameters<typeof itemsFirst>[0];

const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

/** The People board as QA saw it: the column left behind, Lead with two cards, and an empty Customer column. */
const TARGETS = [
  { id: 'no-value', isZone: true, rect: rect(268, 141, 264, 760) },
  { id: 'lead', isZone: true, rect: rect(553, 141, 278, 760) },
  { id: 'leah', isZone: false, rect: rect(561, 183, 262, 86) },
  { id: 'samuel', isZone: false, rect: rect(561, 279, 262, 110) },
  { id: 'customer', isZone: true, rect: rect(845, 141, 278, 760) },
] as const;

function argsAt(collisionRect: ReturnType<typeof rect>, pointer: { x: number; y: number } | null): Args {
  const droppableContainers = TARGETS.map((target) => ({
    id: target.id,
    key: target.id,
    disabled: false,
    data: { current: { isZone: target.isZone } },
    rect: { current: target.rect },
    node: { current: null },
  }));
  return {
    active: { id: 'meera', data: { current: {} }, rect: { current: { initial: null, translated: null } } },
    collisionRect,
    droppableRects: new Map(TARGETS.map((target) => [target.id, target.rect])),
    droppableContainers,
    pointerCoordinates: pointer,
  };
}

describe('itemsFirst', () => {
  it('drops a keyboard move into the empty column the card shows over, not a card in the column it left', () => {
    const hits = itemsFirst(argsAt(rect(845, 141, 262, 86), null));
    expect(hits[0]?.id).toBe('customer');
  });

  it('takes the card under a keyboard move before its column', () => {
    const hits = itemsFirst(argsAt(rect(561, 279, 262, 86), null));
    expect(hits[0]?.id).toBe('samuel');
  });

  it('takes the card under the pointer before its column', () => {
    const hits = itemsFirst(argsAt(rect(600, 300, 262, 86), { x: 700, y: 320 }));
    expect(hits[0]?.id).toBe('samuel');
  });
});
