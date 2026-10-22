// The library's one wrapper around dnd-kit (owner decision, 13 Oct 2026):
// every drag in packages/ui goes through it, and only this folder imports
// dnd-kit (lint). It sets the sensors (a pointer that moves a few pixels
// first, so a press still presses, and the keyboard on a grip), the screen
// reader words, auto scroll, and reduced motion, the same way everywhere.
//
// Keys: Space or Enter on a grip lifts the item, the arrows move it, Space or
// Enter drops it and Escape puts it back. While it is lifted, focus waits on
// a hidden holder outside the list, which hands every key straight to
// dnd-kit, so a React Aria grid or table around the item never turns an
// arrow into focus moving between rows, and an Escape never closes the
// popover the list sits in. On the drop, focus goes back to the grip.
// The one wrapper: the only file that imports dnd-kit (lint refuses it anywhere else in the library).
// eslint-disable-next-line no-restricted-imports -- this is the drag wrapper
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Modifier,
  type SensorDescriptor,
  type SensorOptions,
} from '@dnd-kit/core';
// eslint-disable-next-line no-restricted-imports -- this is the drag wrapper
import {
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  type SortingStrategy,
} from '@dnd-kit/sortable';
// eslint-disable-next-line no-restricted-imports -- this is the drag wrapper
import { CSS as DndCss } from '@dnd-kit/utilities';
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { DragHandle } from '../../atoms/DragHandle/DragHandle.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { focusLater } from '../focus-later.ts';
import { durationToken, easingToken, spaceToken } from '../token-values.ts';
import { strings } from './strings.ts';

/** Which way a list runs: it decides how its items shift and which arrows move them. */
export type DragAxis = 'vertical' | 'horizontal';

/** What a draggable or drop zone carries: the group (a board column) it belongs to, and whether it is a zone. */
export interface DragData {
  readonly group?: string;
  readonly isZone?: boolean;
}

/** A drop: what moved, what it landed on, and which side of it, by the moved item's middle against the target's. */
export interface DragDrop {
  readonly id: string;
  readonly fromGroup: string | undefined;
  readonly overId: string | undefined;
  readonly overGroup: string | undefined;
  readonly overIsZone: boolean;
  readonly side: 'before' | 'after';
}

/** The words a drag says to screen readers, at each step. Each takes the moved item's id. */
export interface DragWords {
  readonly lifted: (id: string) => string;
  readonly over: (id: string, drop: DragDrop | undefined) => string | undefined;
  readonly dropped: (id: string, drop: DragDrop | undefined) => string;
  readonly cancelled: (id: string) => string;
  /** The holder's name while a keyboard move is under way: "Moving Deals". */
  readonly moving: (id: string) => string;
}

const reducedMotion = '(prefers-reduced-motion: reduce)';

/** Whether the person asked for less motion: drags then drop in place, and items jump rather than slide. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = globalThis.matchMedia(reducedMotion);
      query.addEventListener('change', onChange);
      return () => {
        query.removeEventListener('change', onChange);
      };
    },
    () => globalThis.matchMedia(reducedMotion).matches,
    () => false,
  );
}

/** The two sensors: the pointer after a few pixels (a press still presses), and the keyboard on a grip. */
function useDragSensors(hasKeyboard: boolean, isReduced: boolean): SensorDescriptor<SensorOptions>[] {
  const pointer = useSensor(PointerSensor, { activationConstraint: { distance: spaceToken('space-4') } });
  const keyboard = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
    scrollBehavior: isReduced ? 'auto' : 'smooth',
  });
  const both = useSensors(pointer, keyboard);
  const pointerOnly = useSensors(pointer);
  return hasKeyboard ? both : pointerOnly;
}

const dataOf = (value: unknown): DragData => (typeof value === 'object' && value !== null ? value : {});

/** Keeps a vertical list's item on its line: it moves up and down only. */
const alongY: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/** Keeps a horizontal run's item on its line: it moves sideways only. */
const alongX: Modifier = ({ transform }) => ({ ...transform, y: 0 });

/** Items before zones: over a board card, the card wins over its column. */
const itemsFirst: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  // The keyboard has no pointer: the nearest corners, as dnd-kit gives them.
  if (hits.length === 0) return closestCorners(args);
  const zones = new Set(
    args.droppableContainers.flatMap((each) => (dataOf(each.data.current).isZone === true ? [each.id] : [])),
  );
  return [...hits].sort((a, b) => Number(zones.has(a.id)) - Number(zones.has(b.id)));
};

/** The drop a drag event describes, or `undefined` while it is over nothing. */
function dropOf(event: Pick<DragOverEvent, 'active' | 'over'>, axis: DragAxis): DragDrop | undefined {
  const { active, over } = event;
  if (over === null) return undefined;
  const moved = active.rect.current.translated ?? active.rect.current.initial;
  const middle = (rect: {
    readonly top: number;
    readonly left: number;
    readonly width: number;
    readonly height: number;
  }) => (axis === 'vertical' ? rect.top + rect.height / 2 : rect.left + rect.width / 2);
  const overData = dataOf(over.data.current);
  return {
    id: String(active.id),
    fromGroup: dataOf(active.data.current).group,
    overId: String(over.id),
    overGroup: overData.group,
    overIsZone: overData.isZone === true,
    side: moved !== null && middle(moved) > middle(over.rect) ? 'after' : 'before',
  };
}

/** The keys a lifted item listens for; the holder hands them to dnd-kit and keeps them from everything else. */
const DRAG_KEYS = new Set(['Space', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** Props for DragArea. */
export interface DragAreaProps {
  readonly children: ReactNode;
  readonly words: DragWords;
  /** A drop on something (a drop on nothing, or Escape, calls only `onEnd`). */
  readonly onDrop: (drop: DragDrop) => void;
  readonly onLift?: (id: string, group: string | undefined) => void;
  /** What the moving item is over, while it moves. */
  readonly onOver?: (drop: DragDrop | undefined) => void;
  /** The drag is over, dropped or put back. */
  readonly onEnd?: () => void;
  /** Which way the side of a drop is read. */
  readonly axis?: DragAxis;
  /** The keyboard lifts items too (on by default); off where a menu is the keyboard route (grid columns). */
  readonly hasKeyboard?: boolean;
  /** `closest` (a single list) or `items-first` (a board, whose cards sit in zones). */
  readonly collision?: 'closest' | 'items-first';
  /** Draws the moving item in a layer of its own, above everything: for items that leave a scrolling box. */
  readonly overlay?: (id: string) => ReactNode;
  /**
   * Where focus lands after a keyboard move: the item's grip, or its row (a
   * board card, whose grid would otherwise take focus back to a row as the
   * card leaves its column).
   */
  readonly focusAfter?: 'grip' | 'row';
}

/**
 * Where things drag: dnd-kit's context with the house sensors, words, auto
 * scroll and reduced motion, plus the focus holder for keyboard moves.
 */
export function DragArea({
  children,
  words,
  onDrop,
  onLift,
  onOver,
  onEnd,
  axis = 'vertical',
  hasKeyboard = true,
  collision = 'closest',
  overlay,
  focusAfter = 'grip',
}: DragAreaProps) {
  const isReduced = useReducedMotion();
  const sensors = useDragSensors(hasKeyboard, isReduced);
  // Where focus was when a keyboard move began: its list takes focus back if the item's grip is gone (scrolled away).
  const origin = useRef<HTMLElement | undefined>(undefined);
  const lastOver = useRef<{ readonly id: string | undefined; readonly side: string } | undefined>(undefined);
  const [active, setActive] = useState<string | undefined>(undefined);
  const holder = useRef<HTMLSpanElement>(null);
  const isKeyboard = useRef(false);
  const announcements: Announcements = {
    onDragStart: ({ active: moved }) => words.lifted(String(moved.id)),
    onDragOver: ({ active: moved, over }) => words.over(String(moved.id), dropOf({ active: moved, over }, axis)),
    onDragEnd: ({ active: moved, over }) => words.dropped(String(moved.id), dropOf({ active: moved, over }, axis)),
    onDragCancel: ({ active: moved }) => words.cancelled(String(moved.id)),
  };
  const finish = (id: string) => {
    setActive(undefined);
    isKeyboard.current = false;
    lastOver.current = undefined;
    onEnd?.();
    // Focus goes back to the item's grip, wherever the item landed (it may have moved list).
    const from = holder.current;
    const started = origin.current;
    origin.current = undefined;
    focusLater(() => {
      const focused = from?.ownerDocument.activeElement;
      if (focused !== from && focused !== from?.ownerDocument.body) return null;
      const grip = from?.ownerDocument.querySelector<HTMLElement>(`[data-drag-grip="${CSS.escape(id)}"]`);
      if (grip !== null && grip !== undefined)
        return focusAfter === 'row' ? grip.closest<HTMLElement>('[role="row"]') : grip;
      // The item landed out of view (a virtualised column): its list, or where the move began.
      if (started?.isConnected === true) return started;
      return started?.closest<HTMLElement>('[role="grid"], [role="list"], [role="navigation"]') ?? null;
    });
  };
  const onDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    setActive(id);
    onLift?.(id, dataOf(event.active.data.current).group);
    // Focus waits on the holder while anything moves, outside any grid that would take the arrows and any
    // popover that would take Escape; named first, so it is never announced without a name.
    const element = holder.current;
    if (element === null) return;
    isKeyboard.current = event.activatorEvent instanceof KeyboardEvent;
    const focused = element.ownerDocument.activeElement;
    origin.current = focused instanceof HTMLElement ? focused : undefined;
    element.setAttribute('aria-label', words.moving(id));
    element.focus({ preventScroll: true });
  };
  // Told when the target or its side changes (the side moves within one target as the pointer does).
  const onDragOver = (event: DragOverEvent) => {
    const drop = dropOf(event, axis);
    const now = { id: drop?.overId, side: drop?.side ?? '' };
    const last = lastOver.current;
    if (last !== undefined && last.id === now.id && last.side === now.side) return;
    lastOver.current = now;
    onOver?.(drop);
  };
  const onDragEnd = (event: DragEndEvent) => {
    const drop = dropOf(event, axis);
    if (drop !== undefined) onDrop(drop);
    finish(String(event.active.id));
  };
  // Keys on the holder go to dnd-kit's own listener on the document, and nowhere else.
  const onHolderKey = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (active === undefined) return;
    if (event.key === 'Tab') {
      event.preventDefault();
      return;
    }
    // A pointer move takes only Escape from here; a chord (Ctrl Enter) is never the move's, so never the page's either.
    if (!DRAG_KEYS.has(event.code) || (!isKeyboard.current && event.code !== 'Escape')) return;
    if (event.ctrlKey || event.metaKey || event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const { key, code, shiftKey, altKey, ctrlKey, metaKey } = event.nativeEvent;
    event.currentTarget.ownerDocument.dispatchEvent(
      new KeyboardEvent('keydown', { key, code, shiftKey, altKey, ctrlKey, metaKey, bubbles: true, cancelable: true }),
    );
  };
  // Focus wandering off mid move (a click elsewhere) puts the item back.
  const onHolderBlur = () => {
    if (!isKeyboard.current) return;
    holder.current?.ownerDocument.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }),
    );
  };
  const settle = durationToken('duration-move');
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision === 'items-first' ? itemsFirst : closestCorners}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: strings.instructions },
        restoreFocus: false,
        // Its words and live region sit at the end of the page, so they never land inside a grid's rows.
        container: document.body,
      }}
      autoScroll={{ threshold: { x: 0.15, y: 0.15 } }}
      {...(collision === 'closest' ? { modifiers: [axis === 'vertical' ? alongY : alongX] } : {})}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragMove={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={(event) => {
        finish(String(event.active.id));
      }}
    >
      {children}
      {hasKeyboard && (
        <VisuallyHidden>
          {/* eslint-disable-next-line jsx-a11y-x/no-noninteractive-element-interactions -- the keyboard move's focus holder: it takes keys only while a move is under way, named for it */}
          <span ref={holder} role="application" tabIndex={-1} onKeyDown={onHolderKey} onBlur={onHolderBlur} />
        </VisuallyHidden>
      )}
      {overlay !== undefined &&
        createPortal(
          <DragOverlay dropAnimation={isReduced ? null : { duration: settle, easing: easingToken('ease-in-out') }}>
            {active === undefined ? null : overlay(active)}
          </DragOverlay>,
          document.body,
        )}
    </DndContext>
  );
}

/** The grip's wiring from a sortable item: put it on the DragHandle (`drag` prop). */
export interface DragGrip {
  /** The item's id: the grip carries it, so focus finds it again after a keyboard move. */
  readonly id: string;
  /** Binds the grip's element (a ref callback). */
  readonly bind: (element: HTMLElement | null) => void;
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  readonly onClick: (event: ReactMouseEvent<HTMLElement>) => void;
  readonly describedBy: string | undefined;
  readonly isLifted: boolean;
  readonly isDisabled: boolean;
}

/** Options for useSortableItem. */
export interface SortableItemOptions {
  readonly isDisabled?: boolean;
  /** Takes nothing dropped on it (a card in an archived column). */
  readonly refusesDrop?: boolean;
  readonly group?: string;
  /**
   * The item is a React Aria row or card whose element the library doesn't
   * render: the ref goes on anything inside it, and the item is the closest
   * element with this role ("row").
   */
  readonly within?: string;
}

/** What a sortable item gets back: the ref callback for its element (`bind`), its grip, and whether it is the one moving. */
export interface SortableItem {
  readonly bind: (element: HTMLElement | null) => void;
  readonly grip: DragGrip;
  readonly isDragging: boolean;
  /** Pointer wiring for the whole item, when it drags from anywhere on it (a board card). */
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
}

/**
 * One item of a sorting list. Its shift (the slide out of the moving item's
 * way) is set straight on its element, so it works for rows React Aria
 * renders too; reduced motion drops the slide and keeps the jump.
 */
export function useSortableItem(id: string, options: SortableItemOptions = {}): SortableItem {
  const { isDisabled = false, refusesDrop = false, group, within } = options;
  const isReduced = useReducedMotion();
  const sortable = useSortable({
    id,
    disabled: { draggable: isDisabled, droppable: refusesDrop },
    data: { group } satisfies DragData,
    transition: isReduced ? null : { duration: durationToken('duration-move'), easing: easingToken('ease-in-out') },
  });
  const {
    setNodeRef: setNode,
    setActivatorNodeRef: setActivator,
    transform,
    transition,
    isDragging,
    listeners,
    attributes,
  } = sortable;
  const node = useRef<HTMLElement | null>(null);
  const bind = useCallback(
    (element: HTMLElement | null) => {
      const target =
        element === null || within === undefined ? element : element.closest<HTMLElement>(`[role="${within}"]`);
      node.current = target;
      setNode(target);
    },
    [setNode, within],
  );
  const shift = DndCss.Translate.toString(transform);
  useLayoutEffect(() => {
    const element = node.current;
    if (element === null) return;
    element.style.transform = shift ?? '';
    element.style.transition = transition ?? '';
    if (isDragging) element.dataset.dragging = '';
    else delete element.dataset.dragging;
  }, [shift, transition, isDragging]);
  const keyDown = listeners?.onKeyDown as ((event: ReactKeyboardEvent<HTMLElement>) => void) | undefined;
  const pointerDown = listeners?.onPointerDown as ((event: ReactPointerEvent<HTMLElement>) => void) | undefined;
  // From anywhere on the item a mouse or pen drags; a finger scrolls, and drags by the grip.
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'touch') pointerDown?.(event);
  };
  const describedBy = attributes['aria-describedby'];
  const grip = useMemo<DragGrip>(
    () => ({
      id,
      bind: setActivator,
      describedBy,
      isLifted: isDragging,
      isDisabled,
      // The grip keeps its press to itself: the row around it never presses (opens) on a drag.
      onPointerDown: (event) => {
        pointerDown?.(event);
        event.stopPropagation();
      },
      onKeyDown: (event) => {
        if (event.code !== 'Space' && event.code !== 'Enter' && event.key !== ' ' && event.key !== 'Enter') return;
        keyDown?.(event);
        event.stopPropagation();
      },
      // A screen reader's browse mode sends a click for Enter or Space, not the keys: it lifts the same way.
      onClick: (event) => {
        if (event.detail !== 0) return;
        event.currentTarget.dispatchEvent(
          new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }),
        );
      },
    }),
    [id, setActivator, describedBy, isDragging, isDisabled, pointerDown, keyDown],
  );
  return { bind, isDragging, onPointerDown, grip };
}

/** Props for SortableGroup. */
export interface SortableGroupProps {
  readonly ids: readonly string[];
  readonly axis?: DragAxis;
  /** Items shift out of the way only while the moving item is one of them (a board column holds still otherwise). */
  readonly isShifting?: boolean;
  readonly children: ReactNode;
}

const holdStill: SortingStrategy = () => null;

/** One run of sortable items inside a DragArea: a list, or one board column's cards. */
export function SortableGroup({ ids, axis = 'vertical', isShifting = true, children }: SortableGroupProps) {
  const strategy = !isShifting
    ? holdStill
    : axis === 'vertical'
      ? verticalListSortingStrategy
      : horizontalListSortingStrategy;
  return (
    <SortableContext items={ids as string[]} strategy={strategy}>
      {children}
    </SortableContext>
  );
}

/** A place things drop into as a whole (a board column): its ref callback (`bind`), and whether something is over it or one of its items. */
export function useDropZone(id: string, options: { readonly isDisabled?: boolean } = {}) {
  const { setNodeRef: setNode, isOver } = useDroppable({
    id,
    disabled: options.isDisabled === true,
    data: { group: id, isZone: true } satisfies DragData,
  });
  return { bind: setNode, isOver };
}

/** What a list says while one of its items moves, by its place among `ids`, named by `nameOf`. */
export function listWords(ids: readonly string[], nameOf: (id: string) => string): DragWords {
  const count = ids.length;
  const place = (id: string) => ids.indexOf(id) + 1;
  return {
    lifted: (id) => strings.lifted(nameOf(id), place(id), count),
    over: (id, drop) =>
      drop?.overId === undefined ? undefined : strings.position(nameOf(id), place(drop.overId), count),
    dropped: (id, drop) =>
      drop?.overId === undefined || drop.overId === id
        ? strings.stayed(nameOf(id), place(id), count)
        : strings.moved(nameOf(id), place(drop.overId), count),
    cancelled: (id) => strings.cancelled(nameOf(id), place(id), count),
    moving: (id) => strings.moving(nameOf(id)),
  };
}

/** A move in a sorted list: the item, its new index, and the item it now sits before or after. */
export interface ListMove {
  readonly id: string;
  readonly toIndex: number;
  readonly targetId: string;
  readonly position: 'before' | 'after';
}

/** Props for SortableList. */
export interface SortableListProps {
  readonly ids: readonly string[];
  readonly nameOf: (id: string) => string;
  readonly onMove: (move: ListMove) => void;
  readonly axis?: DragAxis;
  readonly children: ReactNode;
  readonly onMovingChange?: (isMoving: boolean) => void;
}

/**
 * A list whose items sort by drag (each item calls `useSortableItem`): the
 * others slide out of the way as it moves, and the drop names the new index
 * and its neighbour, the way `reorder` takes it.
 */
export function SortableList({ ids, nameOf, onMove, axis = 'vertical', children, onMovingChange }: SortableListProps) {
  return (
    <DragArea
      words={listWords(ids, nameOf)}
      axis={axis}
      onLift={() => onMovingChange?.(true)}
      onEnd={() => onMovingChange?.(false)}
      onDrop={(drop) => {
        if (drop.overId === undefined || drop.overId === drop.id) return;
        const from = ids.indexOf(drop.id);
        const to = ids.indexOf(drop.overId);
        if (from < 0 || to < 0) return;
        onMove({ id: drop.id, toIndex: to, targetId: drop.overId, position: to > from ? 'after' : 'before' });
      }}
    >
      <SortableGroup ids={ids} axis={axis}>
        {children}
      </SortableGroup>
    </DragArea>
  );
}

/**
 * Something that drags by pointer and takes drops, without sorting (a grid
 * column header, whose menu is its keyboard route): its ref callback, its pointer
 * wiring, whether it is moving, and whether something is over it.
 */
export function useDragTarget(id: string, options: { readonly isDisabled?: boolean } = {}) {
  const draggable = useDraggable({ id, disabled: options.isDisabled === true });
  const droppable = useDroppable({ id });
  const { setNodeRef: setDrag } = draggable;
  const { setNodeRef: setDrop } = droppable;
  const bind = useCallback(
    (element: HTMLElement | null) => {
      setDrag(element);
      setDrop(element);
    },
    [setDrag, setDrop],
  );
  const pointerDown = draggable.listeners?.onPointerDown as
    ((event: ReactPointerEvent<HTMLElement>) => void) | undefined;
  return {
    bind,
    isDragging: draggable.isDragging,
    isOver: droppable.isOver && !draggable.isDragging,
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      pointerDown?.(event);
    },
  };
}

/** Props for SortableRowGrip. */
export interface SortableRowGripProps {
  readonly id: string;
  /** The grip's name: "Move Stage". */
  readonly label: string;
  /** The row stays put (and others still move around it). */
  readonly isDisabled?: boolean;
  /** Nothing lands on this row's place (a locked first row, a row still being added): the others don't make room. */
  readonly refusesDrop?: boolean;
  /** Where the grip's hit area grows (see DragHandle's `reach`): `end` against an edge that clips. */
  readonly reach?: 'around' | 'end';
}

/**
 * The grip of a React Aria row (a GridList item or a Table row) in a
 * SortableList: it binds its row and draws the DragHandle, or nothing for a
 * row that can't move. Rendered inside the row, so React Aria's collection
 * pass never runs its hooks.
 */
export function SortableRowGrip({
  id,
  label,
  isDisabled = false,
  refusesDrop = false,
  reach = 'around',
}: SortableRowGripProps) {
  const { bind, grip } = useSortableItem(id, { isDisabled, refusesDrop, within: 'row' });
  return (
    <>
      <span ref={bind} hidden />
      <DragHandle label={label} drag={grip} reach={reach} />
    </>
  );
}
