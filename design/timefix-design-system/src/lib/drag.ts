/**
 * The one drag wrapper: every drag in the app goes through here, and this is the only file that imports @dnd-kit.
 * One feel everywhere: the lifted copy follows the pointer (shadow-md, 1.02, no tilt), where it will land stays open as a dashed gap,
 * the rows around it slide aside live (250ms on --ease-smooth-out), and on release the copy glides into the gap and settles.
 * Under a CSS zoom (the dashboard draws at 88%) everything is measured in the page's own units, so the copy stays under the pointer.
 * Keyboard: Space or Enter on a grip lifts, arrows move, Space or Enter drops, Esc puts it back; a screen reader hears each step.
 * With prefers-reduced-motion nothing slides or glides.
 */
import { closestCenter, DndContext, DragOverlay, KeyboardSensor, MeasuringStrategy, PointerSensor, pointerWithin, useDroppable, useSensor, useSensors, type Announcements, type ClientRect, type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent, type KeyboardCoordinateGetter, type Modifier } from '@dnd-kit/core';
import { horizontalListSortingStrategy, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS as DndCss } from '@dnd-kit/utilities';
import { createContext, createElement, useContext, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref } from 'react';

// The Board builds its own lanes on the same primitives.
export { closestCorners, DndContext, DragOverlay, KeyboardSensor, MeasuringStrategy, PointerSensor, pointerWithin, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
export type { Announcements, ClientRect, CollisionDetection, DragEndEvent, DragOverEvent, DragStartEvent, KeyboardCoordinateGetter, Modifier } from '@dnd-kit/core';
export { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';

/** A sortable item's live offset as a CSS transform. */
export const translateOf = (t: { readonly x: number; readonly y: number; readonly scaleX: number; readonly scaleY: number } | null): string | undefined => DndCss.Translate.toString(t);

/** Shifts and the drop glide: --duration-fast (250ms) on --ease-smooth-out. */
export const SHIFT = { duration: 250, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' } as const;
/** How long a dropped row settles: --duration-fast. */
export const SETTLE_MS = 250;

/** True while the person asks for reduced motion; follows the setting live. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => { const m = window.matchMedia('(prefers-reduced-motion: reduce)'); const f = () => setReduced(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  return reduced;
}

/** The CSS zoom an element draws at (the product of its ancestors' zoom); 1 on a page that isn't zoomed. */
export function zoomOf(el: Element | null): number {
  let z = 1;
  for (let n = el; n; n = n.parentElement) z *= parseFloat(getComputedStyle(n).zoom) || 1;
  return z;
}

/** dnd-kit measures on screen but moves things in the page's own units, so under a CSS zoom every length is divided by it.
 *  Rows are measured where they sit without their live slide (as dnd-kit does by default); the lifted copy as drawn. */
export function rectIn(el: HTMLElement, withSlide: boolean): ClientRect {
  const r = el.getBoundingClientRect(); const z = zoomOf(el);
  let dx = 0; let dy = 0;
  if (!withSlide) { const m = getComputedStyle(el).transform; if (m && m !== 'none') { const v = m.slice(m.indexOf('(') + 1, -1).split(',').map(Number); dx = v.length === 6 ? v[4] ?? 0 : v[12] ?? 0; dy = v.length === 6 ? v[5] ?? 0 : v[13] ?? 0; } }
  const top = r.top / z - dy; const left = r.left / z - dx; const width = r.width / z; const height = r.height / z;
  return { top, left, width, height, bottom: top + height, right: left + width };
}

/** dnd-kit's measuring, in the page's own units. */
export const measuring = {
  draggable: { measure: (el: HTMLElement) => rectIn(el, false) },
  droppable: { measure: (el: HTMLElement) => rectIn(el, false), strategy: MeasuringStrategy.WhileDragging },
  dragOverlay: { measure: (el: HTMLElement) => rectIn(el, true) },
};

/** A modifier that turns the pointer's screen pixels into the page's units; keyboard steps already are. */
export function useUnzoom(): { readonly modifier: Modifier; readonly zoom: { current: number } } {
  const zoom = useRef(1);
  const modifier: Modifier = ({ transform, activatorEvent }) => (activatorEvent instanceof KeyboardEvent ? transform : { ...transform, x: transform.x / zoom.current, y: transform.y / zoom.current });
  return { modifier, zoom };
}

/* ------------------------------------------------------------------ sortable lists */

/** Ids per group, in order. A plain list is one group. */
export type DragGroups = Readonly<Record<string, ReadonlyArray<string>>>;
const GROUP = 'group:';

interface AreaContext {
  readonly reduced: boolean;
  readonly settling?: string;
  readonly live: DragGroups;
  readonly layout: DragLayout;
  readonly overGroup?: string;
  readonly many: boolean;
}
const Ctx = createContext<AreaContext | undefined>(undefined);

/** How rows are laid out: a column (default), a row of chips, or a wrapping grid of tiles. */
export type DragLayout = 'list' | 'row' | 'grid';
const strategyOf = (l: DragLayout) => (l === 'grid' ? rectSortingStrategy : l === 'row' ? horizontalListSortingStrategy : verticalListSortingStrategy);

/** Props for DragArea. */
export interface DragAreaProps {
  /** Ids per group, in order. */
  readonly groups: DragGroups;
  /** Called once on drop with every group's new order and the id that moved; nothing is called when the order didn't change. */
  readonly onChange: (next: DragGroups, moved: string) => void;
  /** A row's plain name, for announcements ("Work email"). */
  readonly textOf: (id: string) => string;
  /** A group's name, for announcements when a row crosses groups. */
  readonly groupName?: (group: string) => string;
  /** The lifted copy that follows the pointer: the row's own content. */
  readonly overlay: (id: string) => ReactNode;
  readonly layout?: DragLayout;
  /** For groups of different kinds in one area (a menu's sections and its items): a row only lands among rows of its own kind. */
  readonly kindOf?: (group: string) => string;
  /** Rows draw in this order while something is lifted, so render with it: `(live) => …`. */
  readonly children: (live: DragGroups) => ReactNode;
}

const flatIndex = (g: DragGroups, id: string): { readonly group?: string; readonly index: number } => {
  for (const [k, ids] of Object.entries(g)) { const i = ids.indexOf(id); if (i >= 0) return { group: k, index: i }; }
  return { index: -1 };
};

/** Collisions: the group under the pointer first (so a drop anywhere down a group counts), then the nearest row inside it. */
const collideIn = (zoom: { current: number }, many: boolean, same: (d: { readonly data: { readonly current?: Record<string, unknown> } }) => boolean): CollisionDetection => (raw) => {
  const args = { ...raw, droppableContainers: raw.droppableContainers.filter(same) };
  if (!many) return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((d) => !d.data.current?.isGroup) });
  const z = zoom.current;
  const at = args.pointerCoordinates ? { x: args.pointerCoordinates.x / z, y: args.pointerCoordinates.y / z } : null;
  const within = at ? pointerWithin({ ...args, pointerCoordinates: at }) : [];
  const group = within.find((c) => String(c.id).startsWith(GROUP));
  if (!group) return closestCenter(args);
  const gid = String(group.id).slice(GROUP.length);
  const rows = args.droppableContainers.filter((d) => d.data.current?.group === gid && !d.data.current?.isGroup);
  const near = closestCenter({ ...args, droppableContainers: rows });
  return near.length ? near : [group];
};

/**
 * Sortable rows in one or more groups (a list, stage groups, lanes). Rows use `useDragRow`, each group's list uses `useDragGroup`.
 * The lifted copy is `overlay(id)` inside `.tf-drag-lift`; the row it came from stays as the dashed gap (`[data-drag-row][data-dragging]`).
 */
export function DragArea({ groups, onChange, textOf, groupName, overlay, layout = 'list', kindOf, children }: DragAreaProps) {
  const reduced = useReducedMotion();
  const [live, setLive] = useState<DragGroups | undefined>(undefined);
  const [active, setActive] = useState<string>();
  const [overGroup, setOverGroup] = useState<string>();
  const [settling, setSettling] = useState<string>();
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const shown = live ?? groups;
  const many = Object.keys(groups).length > 1;
  const { modifier, zoom } = useUnzoom();
  const kindNow = useRef<string | undefined>(undefined);
  const same = (d: { readonly data: { readonly current?: Record<string, unknown> } }) => !kindOf || kindNow.current === undefined || kindOf(String(d.data.current?.group ?? '')) === kindNow.current;
  const keys: KeyboardCoordinateGetter = (event, args) => sortableKeyboardCoordinates(event, !kindOf ? args : {
    ...args, context: { ...args.context, droppableContainers: Object.assign(Object.create(args.context.droppableContainers) as typeof args.context.droppableContainers, { getEnabled: () => args.context.droppableContainers.getEnabled().filter(same) }) },
  });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keys }),
  );
  const groupOf = (id: string, from: DragGroups): string | undefined => (id.startsWith(GROUP) ? id.slice(GROUP.length) : flatIndex(from, id).group);

  const onDragStart = (e: DragStartEvent) => {
    zoom.current = zoomOf(document.querySelector(`[data-drag-row="${CSS.escape(String(e.active.id))}"]`));
    const g = flatIndex(groups, String(e.active.id)).group; kindNow.current = kindOf && g ? kindOf(g) : undefined;
    setLive(groups); setActive(String(e.active.id)); setOverGroup(flatIndex(groups, String(e.active.id)).group);
  };
  const onDragOver = (e: DragOverEvent) => {
    const id = String(e.active.id); const overId = e.over ? String(e.over.id) : undefined;
    if (!overId) return;
    setLive((cur) => {
      const now = cur ?? groups;
      const a = groupOf(id, now); const b = groupOf(overId, now);
      if (!a || !b || a === b) return now;
      const target = now[b] ?? [];
      const at = overId.startsWith(GROUP) ? target.length : Math.max(0, target.indexOf(overId));
      const rect = e.active.rect.current.translated; const overRect = e.over?.rect;
      const below = rect && overRect && !overId.startsWith(GROUP) ? rect.top + rect.height / 2 > overRect.top + overRect.height / 2 : false;
      const index = below ? at + 1 : at;
      return { ...now, [a]: (now[a] ?? []).filter((x) => x !== id), [b]: [...target.slice(0, index), id, ...target.slice(index)] };
    });
    setOverGroup(groupOf(overId, live ?? groups));
  };
  const onDragEnd = (e: DragEndEvent) => {
    const id = String(e.active.id); const overId = e.over ? String(e.over.id) : undefined;
    const now = live ?? groups;
    setLive(undefined); setActive(undefined); setOverGroup(undefined); kindNow.current = undefined;
    const to = groupOf(id, now);
    if (!to || !overId) return;
    const order = [...(now[to] ?? [])];
    if (!overId.startsWith(GROUP) && groupOf(overId, now) === to && overId !== id) {
      const from = order.indexOf(id); const at = order.indexOf(overId);
      order.splice(from, 1); order.splice(at, 0, id);
    }
    const next: DragGroups = { ...now, [to]: order };
    const same = Object.keys(groups).every((k) => (groups[k] ?? []).join('\u0000') === (next[k] ?? []).join('\u0000'));
    if (same) return;
    onChange(next, id);
    setSettling(id);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSettling(undefined), SETTLE_MS * 2);
  };
  const onDragCancel = () => { setLive(undefined); setActive(undefined); setOverGroup(undefined); kindNow.current = undefined; };

  const where = (id: string, g: DragGroups) => {
    const { group, index } = flatIndex(g, id);
    const total = group ? (g[group] ?? []).length : 0;
    return `position ${index + 1} of ${total}${many && group && groupName ? ` in ${groupName(group)}` : ''}`;
  };
  const announcements: Announcements = {
    onDragStart: ({ active: a }) => `Picked up ${textOf(String(a.id))}, ${where(String(a.id), groups)}.`,
    onDragOver: ({ active: a, over }) => (over ? `${textOf(String(a.id))} is at ${where(String(a.id), live ?? groups)}.` : `${textOf(String(a.id))} is not over the list.`),
    onDragEnd: ({ active: a, over }) => (over ? `${textOf(String(a.id))} dropped at ${where(String(a.id), live ?? groups)}.` : `${textOf(String(a.id))} put back.`),
    onDragCancel: ({ active: a }) => `Moving ${textOf(String(a.id))} was cancelled. It is back where it was.`,
  };
  const ctx: AreaContext = { reduced, settling, live: shown, layout, overGroup: active ? overGroup : undefined, many };
  return createElement(DndContext, {
    sensors, collisionDetection: collideIn(zoom, many, same), measuring, modifiers: [modifier], onDragStart, onDragOver, onDragEnd, onDragCancel,
    accessibility: { announcements, screenReaderInstructions: { draggable: 'To pick up a row, press Space or Enter on its grip. Use the arrow keys to move it, Space or Enter to drop it, Escape to put it back.' } },
  },
  createElement(Ctx.Provider, { value: ctx },
    !many ? createElement(SortableContext, { id: Object.keys(groups)[0] ?? 'list', items: [...(shown[Object.keys(groups)[0] ?? 'list'] ?? [])], strategy: strategyOf(layout), children: children(shown) }) : children(shown),
    createElement(DragOverlay, { dropAnimation: reduced ? null : { duration: SHIFT.duration, easing: SHIFT.easing } },
      active ? createElement('div', { className: 'tf-drag-lift' }, overlay(active)) : null)));
}

/** Props for DragList: DragArea for one plain list. */
export interface DragListProps {
  readonly ids: ReadonlyArray<string>;
  /** The whole list in its new order, once, on drop. */
  readonly onReorder: (ids: ReadonlyArray<string>, moved: string) => void;
  readonly textOf: (id: string) => string;
  readonly overlay: (id: string) => ReactNode;
  readonly layout?: DragLayout;
  readonly children: ReactNode;
}

/** One sortable list. Render the rows in your own order; they slide aside while one is lifted and the order changes on drop. */
export function DragList({ ids, onReorder, textOf, overlay, layout, children }: DragListProps) {
  return createElement(DragArea, { groups: { list: ids }, onChange: (next: DragGroups, moved: string) => onReorder(next.list ?? ids, moved), textOf, overlay, layout, children: () => children });
}

/** Props a group's list element takes: its ref (so the whole group takes a drop) and whether a row is over it. */
export function useDragGroup(id: string): { readonly ref: (el: HTMLElement | null) => void; readonly isOver: boolean; readonly ids: ReadonlyArray<string> } {
  const ctx = useContext(Ctx);
  const { setNodeRef } = useDroppable({ id: GROUP + id, data: { group: id, isGroup: true }, disabled: !ctx?.many });
  return { ref: setNodeRef, isOver: ctx?.overGroup === id, ids: ctx?.live[id] ?? [] };
}

/** Wraps one group's rows when a DragArea holds several groups. */
export function DragGroup({ id, children }: { readonly id: string; readonly children: ReactNode }) {
  const ctx = useContext(Ctx);
  return createElement(SortableContext, { id, items: [...(ctx?.live[id] ?? [])], strategy: strategyOf(ctx?.layout ?? 'list'), children });
}

/** What a sortable row spreads: on its element (`row`) and on its grip (`grip`). */
export interface DragRow {
  readonly row: {
    readonly ref: Ref<never>;
    readonly style: CSSProperties;
    readonly 'data-drag-row': string;
    readonly 'data-dragging'?: true;
    readonly 'data-settling'?: true;
  };
  readonly grip: {
    readonly ref: Ref<never>;
    readonly 'aria-roledescription'?: string;
    readonly 'aria-describedby'?: string;
    readonly 'aria-disabled'?: boolean;
    readonly 'aria-pressed'?: boolean;
    readonly tabIndex?: number;
    readonly onPointerDown?: (e: ReactPointerEvent) => void;
    readonly onKeyDown?: (e: ReactKeyboardEvent) => void;
  };
  readonly isDragging: boolean;
}

/** One row of a DragArea or DragList: spread `row` on the row and `grip` on its grip button (the only place a drag starts). */
export function useDragRow(id: string, opts: { readonly group?: string; readonly disabled?: boolean } = {}): DragRow {
  const ctx = useContext(Ctx);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id, disabled: opts.disabled, data: { group: opts.group ?? 'list' }, transition: ctx?.reduced ? null : SHIFT,
  });
  const style: CSSProperties = { transform: DndCss.Translate.toString(transform), transition: transition ?? undefined };
  const l = listeners as { onPointerDown?: (e: ReactPointerEvent) => void; onKeyDown?: (e: ReactKeyboardEvent) => void } | undefined;
  return {
    row: { ref: setNodeRef as Ref<never>, style, 'data-drag-row': id, 'data-dragging': isDragging || undefined, 'data-settling': ctx?.settling === id || undefined },
    grip: {
      ref: setActivatorNodeRef as Ref<never>,
      'aria-roledescription': attributes['aria-roledescription'], 'aria-describedby': attributes['aria-describedby'],
      'aria-disabled': attributes['aria-disabled'], 'aria-pressed': attributes['aria-pressed'], tabIndex: opts.disabled ? -1 : 0,
      onPointerDown: l?.onPointerDown, onKeyDown: l?.onKeyDown,
    },
    isDragging,
  };
}
