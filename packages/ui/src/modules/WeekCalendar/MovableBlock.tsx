import type { PointerEvent, ReactNode } from 'react';
import { usePlaneItem } from '../../lib/drag/plane.tsx';

/** What a movable block's button gets: where to bind it, how a press grabs it, and the same for the edge that changes its length. */
export interface BlockWire {
  readonly bind: (element: HTMLElement | null) => void;
  readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  /** The edge at the block's foot: grabbed, it changes the block's length. The week draws it inside the block. */
  readonly bindEdge: (element: HTMLElement | null) => void;
  readonly onEdgePointerDown: (event: PointerEvent<HTMLElement>) => void;
}

/**
 * Lends one block the plane drag (see `lib/drag/plane.tsx`): the body grabs to move, the edge at the foot to resize.
 * A render prop, since the hooks are per block and the block's markup stays the week's own. Blocks that can't move
 * don't use this at all, so a week of events and busy time holds no drag hooks.
 */
export function MovableBlock({
  id,
  children,
}: {
  readonly id: string;
  readonly children: (wire: BlockWire) => ReactNode;
}) {
  const { bind, onPointerDown } = usePlaneItem(id, 'move');
  const { bind: bindEdge, onPointerDown: onEdgePointerDown } = usePlaneItem(id, 'resize');
  return children({ bind, onPointerDown, bindEdge, onEdgePointerDown });
}
