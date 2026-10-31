// The drag wrapper's free-form half (owner decision, 13 Oct 2026: every drag goes through lib/drag): things that
// move over a plane rather than sort in a list, such as a booking on the week. It sets the same pointer sensor as
// DragArea (a few pixels first, so a press still presses; a finger scrolls instead), reports how far the pointer
// has travelled, auto scrolls the box the plane sits in, and leaves what that travel means (snapping to a grid,
// which day, which length) to the caller, who knows the grid. There is no keyboard sensor: a plane's keyboard route
// is the caller's own keys (the week's Alt and arrow keys), which commit through the same callbacks.
// The one wrapper: the only file that imports dnd-kit (lint refuses it anywhere else in the library).
// eslint-disable-next-line no-restricted-imports -- this is the drag wrapper
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useCallback, useMemo, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { spaceToken } from '../token-values.ts';

/** What is held: the item, and which part of it (`move` by its body, `resize` by an edge). */
export interface PlaneGrab {
  readonly id: string;
  readonly part: string;
}

/** How far the pointer has travelled since the grab, in pixels, scrolling of the plane's box included. */
export interface PlaneTravel {
  readonly x: number;
  readonly y: number;
}

/** Props for PlaneArea. */
export interface PlaneAreaProps {
  readonly children: ReactNode;
  /** An item was grabbed and has moved past the first few pixels. */
  readonly onLift: (grab: PlaneGrab) => void;
  /** The pointer moved, or the box scrolled under it. */
  readonly onTravel: (grab: PlaneGrab, travel: PlaneTravel) => void;
  /** Let go, with the last travel. */
  readonly onDrop: (grab: PlaneGrab, travel: PlaneTravel) => void;
  /** Escape, or the browser took the pointer: put it back. */
  readonly onCancel: (grab: PlaneGrab) => void;
}

const grabOf = (value: unknown): PlaneGrab | undefined => {
  if (typeof value !== 'object' || value === null || !('id' in value) || !('part' in value)) return undefined;
  const { id, part } = value;
  return typeof id === 'string' && typeof part === 'string' ? { id, part } : undefined;
};

/** Nothing is announced for a pointer's plane drag: the caller's live region says what it landed on. */
const silent: Announcements = {
  onDragStart: () => undefined,
  onDragOver: () => undefined,
  onDragEnd: () => undefined,
  onDragCancel: () => undefined,
};

/**
 * Where things move over a plane: dnd-kit's context with the house pointer sensor and auto scroll, reporting
 * grabs, travel and drops. Items inside call `usePlaneItem`.
 */
export function PlaneArea({ children, onLift, onTravel, onDrop, onCancel }: PlaneAreaProps) {
  const pointer = useSensor(PointerSensor, { activationConstraint: { distance: spaceToken('space-4') } });
  const sensors = useSensors(pointer);
  const grab = (event: { readonly active: { readonly data: { readonly current?: unknown } } }) =>
    grabOf(event.active.data.current);
  return (
    <DndContext
      sensors={sensors}
      accessibility={{ announcements: silent, restoreFocus: false, container: document.body }}
      autoScroll={{ threshold: { x: 0.15, y: 0.15 } }}
      onDragStart={(event: DragStartEvent) => {
        const held = grab(event);
        if (held !== undefined) onLift(held);
      }}
      onDragMove={(event: DragMoveEvent) => {
        const held = grab(event);
        if (held !== undefined) onTravel(held, { x: event.delta.x, y: event.delta.y });
      }}
      onDragEnd={(event: DragEndEvent) => {
        const held = grab(event);
        if (held !== undefined) onDrop(held, { x: event.delta.x, y: event.delta.y });
      }}
      onDragCancel={(event) => {
        const held = grab(event);
        if (held !== undefined) onCancel(held);
      }}
    >
      {children}
    </DndContext>
  );
}

/** Options for usePlaneItem. */
export interface PlaneItemOptions {
  /** The part stays put (a booking that has started, one moved the most it can). */
  readonly isDisabled?: boolean;
}

/** What a plane item gets back: the ref callback for the element to grab, its pointer wiring, and whether it is held. */
export interface PlaneItem {
  readonly bind: (element: HTMLElement | null) => void;
  /** Starts the grab; a finger is left to scroll. */
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly isDragging: boolean;
}

/**
 * One grabbable part of an item inside a PlaneArea. Mouse and pen drag from anywhere on the element; a finger
 * scrolls (the plane's caller offers another route on touch). A press that never travels is still a press.
 */
export function usePlaneItem(id: string, part: string, options: PlaneItemOptions = {}): PlaneItem {
  const { isDisabled = false } = options;
  const data = useMemo<PlaneGrab>(() => ({ id, part }), [id, part]);
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: `${id}|${part}`, disabled: isDisabled, data });
  const pointerDown = listeners?.onPointerDown as ((event: ReactPointerEvent<HTMLElement>) => void) | undefined;
  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === 'touch') return;
      pointerDown?.(event);
      // A part inside another (the edge in the body) keeps its press to itself: the body doesn't start a move too.
      if (part !== 'move') event.stopPropagation();
    },
    [pointerDown, part],
  );
  return { bind: setNodeRef, onPointerDown, isDragging };
}
