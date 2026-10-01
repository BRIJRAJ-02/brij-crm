// One column header: the type's icon and the attribute's name (with the
// function or AI mark), the column menu (the keyboard route to moving,
// pinning, hiding, sorting, filtering and resizing), an edge to drag for
// width, and React Aria drag and drop to reorder.
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { mergeProps, useDrag, useDrop } from 'react-aria';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { Tooltip } from '../../atoms/Tooltip/Tooltip.tsx';
import { TruncatedText } from '../../atoms/TruncatedText/TruncatedText.tsx';
import { fieldTypeOf } from '../../fields/registry.ts';
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from '../../molecules/Menu/Menu.tsx';
import type { CellPlace } from './GridCell.tsx';
import type { GridColumn } from './grid-columns.ts';
import styles from './GridHeaderCell.module.css';
import { strings } from './strings.ts';

/** What the column menu can do. Sort and filter show only when the screen handles them. */
export interface ColumnActions {
  readonly onMove: (direction: -1 | 1) => void;
  readonly onPin: () => void;
  readonly onUnpin: () => void;
  readonly onHide: () => void;
  readonly onSort?: (direction: 'ascending' | 'descending') => void;
  readonly onFilter?: () => void;
  readonly onStartResize: () => void;
  /** A pointer resize: the width while dragging, then once more on release. */
  readonly onResize: (width: number, isDone: boolean) => void;
  /** A dropped column lands before or after this one, by which half of it the pointer is over. */
  readonly onDrop: (columnId: string, side: 'before' | 'after') => void;
}

/** Props for GridHeaderCell. */
export interface GridHeaderCellProps {
  readonly column: GridColumn;
  readonly place: CellPlace;
  readonly isRowHeader: boolean;
  readonly isPinned: boolean;
  readonly canMoveLeft: boolean;
  readonly canMoveRight: boolean;
  readonly isFocused: boolean;
  readonly isResizing: boolean;
  readonly isMenuOpen: boolean;
  readonly onMenuOpenChange: (isOpen: boolean) => void;
  readonly actions: ColumnActions;
}

const COLUMN_TYPE = 'application/x-crm-grid-column';

type MenuAction = 'left' | 'right' | 'pin' | 'unpin' | 'hide' | 'ascending' | 'descending' | 'filter' | 'resize';

/** A column header with its menu, resize edge and drag to reorder. */
export function GridHeaderCell({
  column,
  place,
  isRowHeader,
  isPinned,
  canMoveLeft,
  canMoveRight,
  isFocused,
  isResizing,
  isMenuOpen,
  onMenuOpenChange,
  actions,
}: GridHeaderCellProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [dropSide, setDropSide] = useState<'before' | 'after'>('before');
  const { attribute } = column;
  /** Which half of the header a drag is over, at `x` from its start. */
  const sideAt = (x: number) => {
    const element = ref.current;
    if (element === null) return 'before';
    const isFirstHalf = x < element.offsetWidth / 2;
    return isFirstHalf === (getComputedStyle(element).direction !== 'rtl') ? 'before' : 'after';
  };
  const { dragProps, isDragging } = useDrag({
    isDisabled: isRowHeader,
    getItems: () => [{ [COLUMN_TYPE]: column.id, 'text/plain': attribute.name }],
    getAllowedDropOperations: () => ['move'],
  });
  const { dropProps, isDropTarget } = useDrop({
    ref,
    getDropOperation: (types) => (types.has(COLUMN_TYPE) ? 'move' : 'cancel'),
    onDropEnter: (event) => {
      setDropSide(isRowHeader ? 'after' : sideAt(event.x));
    },
    onDropMove: (event) => {
      setDropSide(isRowHeader ? 'after' : sideAt(event.x));
    },
    onDrop: (event) => {
      // Nothing lands before the row header.
      const side = isRowHeader ? 'after' : sideAt(event.x);
      void (async () => {
        for (const item of event.items) {
          if (item.kind !== 'text' || !item.types.has(COLUMN_TYPE)) continue;
          const dragged = await item.getText(COLUMN_TYPE);
          if (dragged !== column.id) actions.onDrop(dragged, side);
        }
      })();
    },
  });
  // Pointer drag only: the column menu is the keyboard route, so React Aria's
  // keyboard drag (Enter) never takes the header's keys.
  const { draggable, onDragStart, onDrag, onDragEnd } = dragProps;
  const pointerDrag = { draggable, onDragStart, onDrag, onDragEnd };

  const onAction = (key: MenuAction) => {
    if (key === 'left') actions.onMove(-1);
    else if (key === 'right') actions.onMove(1);
    else if (key === 'pin') actions.onPin();
    else if (key === 'unpin') actions.onUnpin();
    else if (key === 'hide') actions.onHide();
    else if (key === 'ascending' || key === 'descending') actions.onSort?.(key);
    else if (key === 'filter') actions.onFilter?.();
    else actions.onStartResize();
  };

  const startResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = column.width;
    const direction = getComputedStyle(handle).direction === 'rtl' ? -1 : 1;
    const widthAt = (clientX: number) => startWidth + direction * (clientX - startX);
    const move = (moved: PointerEvent) => {
      actions.onResize(widthAt(moved.clientX), false);
    };
    const end = (ended: PointerEvent) => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      actions.onResize(widthAt(ended.clientX), true);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };

  return (
    <div
      ref={ref}
      role="columnheader"
      aria-colindex={place.col + 1}
      className={styles.root}
      data-cell={`-1:${String(place.col)}`}
      data-focused={isFocused || undefined}
      data-sticky={place.stickyOffset === undefined ? undefined : ''}
      data-last-pinned={place.isLastPinned === true ? '' : undefined}
      data-dragging={isDragging || undefined}
      data-drop-target={isDropTarget ? dropSide : undefined}
      data-resizing={isResizing || undefined}
      data-align={fieldTypeOf(attribute.type).align}
      tabIndex={isFocused ? 0 : -1}
      style={{ '--col-width': `${String(place.width)}px`, '--col-offset': `${String(place.stickyOffset ?? 0)}px` }}
      {...mergeProps(pointerDrag, dropProps)}
    >
      <Icon name={fieldTypeOf(attribute.type).icon} size="sm" tone="muted" />
      <span className={styles.name}>
        {/* While resizing, the keys are on show, and the grid announces the width. */}
        <Tooltip content={strings.resizeHint} isTextTrigger isOpen={isResizing}>
          <TruncatedText>{attribute.name}</TruncatedText>
        </Tooltip>
      </span>
      {attribute.computed !== undefined && (
        <Icon name="square-function" size="sm" tone="muted" label={strings.computedColumn} />
      )}
      {attribute.ai !== undefined && <Icon name="sparkles" size="sm" tone="ai" label={strings.aiColumn} />}
      <MenuTrigger isOpen={isMenuOpen} onOpenChange={onMenuOpenChange}>
        <Button variant="ghost" icon="chevron-down" label={strings.columnOptions(attribute.name)} />
        <Menu<object>
          label={strings.columnOptions(attribute.name)}
          onAction={(key) => {
            onAction(key as MenuAction);
          }}
          disabledKeys={[
            ...(canMoveLeft ? [] : ['left']),
            ...(canMoveRight ? [] : ['right']),
            ...(isRowHeader ? ['unpin', 'hide'] : []),
          ]}
        >
          <MenuItem id="left" icon="arrow-left">
            {strings.moveLeft}
          </MenuItem>
          <MenuItem id="right" icon="arrow-right">
            {strings.moveRight}
          </MenuItem>
          {/* Keyed, so pinning swaps the item rather than changing its id while the menu closes. */}
          {isPinned ? (
            <MenuItem key="unpin" id="unpin" icon="pin-off">
              {strings.unpin}
            </MenuItem>
          ) : (
            <MenuItem key="pin" id="pin" icon="pin">
              {strings.pin}
            </MenuItem>
          )}
          <MenuItem id="hide" icon="eye-off">
            {strings.hide}
          </MenuItem>
          <MenuItem id="resize" icon="arrow-left-right">
            {strings.resize}
          </MenuItem>
          {(actions.onSort !== undefined || actions.onFilter !== undefined) && <MenuSeparator />}
          {actions.onSort !== undefined && (
            <MenuItem id="ascending" icon="arrow-up-narrow-wide">
              {strings.sortAscending}
            </MenuItem>
          )}
          {actions.onSort !== undefined && (
            <MenuItem id="descending" icon="arrow-down-wide-narrow">
              {strings.sortDescending}
            </MenuItem>
          )}
          {actions.onFilter !== undefined && (
            <MenuItem id="filter" icon="list-filter">
              {strings.filter}
            </MenuItem>
          )}
        </Menu>
      </MenuTrigger>
      <span className={styles.resize} aria-hidden="true" onPointerDown={startResize} />
    </div>
  );
}
