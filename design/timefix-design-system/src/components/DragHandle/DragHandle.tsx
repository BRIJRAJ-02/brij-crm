import type { HTMLAttributes, ReactNode } from 'react';
import { GripVertical } from 'lucide-react';
import { DragList, useDragRow, type DragRow } from '../../lib/drag.ts';
import { cx } from '../../lib/cx.ts';
import './DragHandle.css';

/** Props for DragHandle. */
export interface DragHandleProps {
  /** What moving it does, for screen readers: "Move Discovery call". */
  readonly label: string;
  /** Picked up: shows grabbing in the accent until dropped. */
  readonly isLifted?: boolean;
  /** `hover` (default) shows the grip when its row is hovered or holds focus; `always` for touch-first lists. */
  readonly reveal?: 'hover' | 'always';
  /** The grip props from `useDragRow` (lib/drag.ts); without them the grip only draws (a demo or a lifted copy). */
  readonly drag?: DragRow['grip'];
  readonly size?: 'md' | 'sm';
}

/** The 6-dot grip a row or card is moved by: grab cursor, keyboard focusable, accent while lifted. A row that can't move draws none. */
export function DragHandle({ label, isLifted = false, reveal = 'hover', drag, size = 'md' }: DragHandleProps) {
  return (
    <button type="button" aria-label={label} {...drag} className={cx('tf-drag-handle', reveal === 'hover' && 'tf-drag-handle--hover', size === 'sm' && 'tf-drag-handle--sm')} data-lifted={isLifted || undefined}>
      <GripVertical size={size === 'sm' ? 14 : 16} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}

/** One item of a SortableList. */
export interface SortableItem { readonly id: string }

/** Props for SortableList. */
export interface SortableListProps<T extends SortableItem> {
  readonly items: ReadonlyArray<T>;
  /** Names the list: "Pipeline stages". */
  readonly label: string;
  /** Called with the whole list in its new order. */
  readonly onReorder: (next: ReadonlyArray<T>) => void;
  /** The item's plain text, for the handle's name and announcements. */
  readonly getText: (item: T) => string;
  /** The row's content after the grip. */
  readonly children: (item: T) => ReactNode;
}

/** A list ordered by dragging its grips, or with the keyboard (Space on a grip, arrows, Space to drop, Esc to cancel). Built on lib/drag.ts. */
export function SortableList<T extends SortableItem>({ items, label, onReorder, getText, children }: SortableListProps<T>) {
  const byId = new Map(items.map((i) => [i.id, i] as const));
  return (
    <DragList ids={items.map((i) => i.id)} textOf={(id) => { const i = byId.get(id); return i ? getText(i) : id; }}
      onReorder={(ids) => onReorder(ids.map((id) => byId.get(id)).filter((i): i is T => Boolean(i)))}
      overlay={(id) => { const i = byId.get(id); return i ? <div className="tf-sortable__row"><DragHandle label="" reveal="always" isLifted />{children(i)}</div> : null; }}>
      <ul aria-label={label} className="tf-sortable">
        {items.map((item) => <SortableRow key={item.id} item={item} getText={getText}>{children}</SortableRow>)}
      </ul>
    </DragList>
  );
}

/** Props for DragItem. */
export interface DragItemProps extends Omit<HTMLAttributes<HTMLLIElement>, 'children' | 'style'> {
  readonly id: string;
  /** The group it belongs to inside a DragArea with several groups. */
  readonly group?: string;
  readonly isDisabled?: boolean;
  /** The row's content; spread `d.grip` on its DragHandle (`drag={d.grip}`). */
  readonly children: (d: DragRow) => ReactNode;
}

/** One sortable `<li>` of a DragList or DragArea, for lists with their own markup. */
export function DragItem({ id, group, isDisabled, children, ...rest }: DragItemProps) {
  const d = useDragRow(id, { group, disabled: isDisabled });
  return <li {...rest} {...d.row}>{children(d)}</li>;
}

function SortableRow<T extends SortableItem>({ item, getText, children }: { readonly item: T; readonly getText: (item: T) => string; readonly children: (item: T) => ReactNode }) {
  const d = useDragRow(item.id);
  return (
    <li {...d.row} className="tf-sortable__row">
      <DragHandle label={`Move ${getText(item)}`} isLifted={d.isDragging} drag={d.grip} />
      {children(item)}
    </li>
  );
}
