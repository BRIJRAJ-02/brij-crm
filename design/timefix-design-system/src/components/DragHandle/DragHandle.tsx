import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button as AriaButton, DropIndicator, GridList, GridListItem, useDragAndDrop } from 'react-aria-components';
import { GripVertical } from 'lucide-react';
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
  /** React Aria's slot; `drag` (default) makes it the drag button of a GridList or Table row. Pass `null` outside a collection. */
  readonly slot?: string | null;
}

/** The 6-dot grip a row or card is moved by: grab cursor, keyboard focusable, accent while lifted. A row that can't move draws none. */
export function DragHandle({ label, isLifted = false, reveal = 'hover', slot = 'drag' }: DragHandleProps) {
  return (
    <AriaButton slot={slot} aria-label={label} className={cx('tf-drag-handle', reveal === 'hover' && 'tf-drag-handle--hover')} data-lifted={isLifted || undefined}>
      <GripVertical size={16} strokeWidth={1.75} aria-hidden="true" />
    </AriaButton>
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
  /** The item's plain text, for type-ahead, the handle's name and announcements. */
  readonly getText: (item: T) => string;
  /** The row's content after the grip. */
  readonly children: (item: T) => ReactNode;
}

const TYPE = 'application/x-tf-sortable';

/** A list ordered by dragging its grips, or with the keyboard (Enter on a grip, arrows, Enter to drop, Esc to cancel). */
export function SortableList<T extends SortableItem>({ items, label, onReorder, getText, children }: SortableListProps<T>) {
  const [settling, setSettling] = useState<string | undefined>(undefined);
  const t = useRef(0);
  useEffect(() => () => window.clearTimeout(t.current), []);
  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((k) => {
      const item = items.find((i) => i.id === k);
      return { [TYPE]: String(k), 'text/plain': item ? getText(item) : String(k) };
    }),
    onReorder: (e) => {
      const moving = items.filter((i) => e.keys.has(i.id));
      const rest = items.filter((i) => !e.keys.has(i.id));
      const at = rest.findIndex((i) => i.id === e.target.key);
      const index = at < 0 ? rest.length : e.target.dropPosition === 'before' ? at : at + 1;
      onReorder([...rest.slice(0, index), ...moving, ...rest.slice(index)]);
      setSettling(moving[0]?.id);
      window.clearTimeout(t.current);
      t.current = window.setTimeout(() => setSettling(undefined), 260);
    },
    renderDropIndicator: (target) => <DropIndicator target={target} className="tf-sortable__slot" />,
    renderDragPreview: (dragged) => {
      const item = items.find((i) => i.id === dragged[0]?.[TYPE]);
      return (
        <div className="tf-sortable__preview">
          <div className="tf-sortable__row tf-sortable__row--lifted">
            <span className="tf-drag-handle" data-lifted=""><GripVertical size={16} strokeWidth={1.75} aria-hidden="true" /></span>
            {item ? children(item) : null}
          </div>
        </div>
      );
    },
  });
  return (
    <GridList aria-label={label} items={items} dragAndDropHooks={dragAndDropHooks} className="tf-sortable">
      {(item) => (
        <GridListItem id={item.id} textValue={getText(item)} className={cx('tf-sortable__row', settling === item.id && 'is-settling')}>
          {({ isDragging }) => (
            <>
              <DragHandle label={`Move ${getText(item)}`} isLifted={isDragging} />
              {children(item)}
            </>
          )}
        </GridListItem>
      )}
    </GridList>
  );
}
