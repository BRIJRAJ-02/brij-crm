// One column header: the type's icon and the attribute's name (with the
// function or AI mark), the column menu (the keyboard route to moving,
// pinning, hiding, sorting, filtering and resizing), an edge to drag for
// width, and React Aria drag and drop to reorder.
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Tooltip } from '../../atoms/Tooltip/Tooltip.tsx';
import { TruncatedText } from '../../atoms/TruncatedText/TruncatedText.tsx';
import { fieldTypeOf, iconOf, readOnlyReasonOf } from '../../fields/registry.ts';
import { useDragTarget, type DragWords } from '../../lib/drag/drag.tsx';
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
  /** The screen's own items, after the menu's (spec 0012: Edit attribute, Archive attribute). */
  readonly extra?: readonly GridColumnAction[];
}

/**
 * An item a screen adds to a column's menu (spec 0012), after the menu's own:
 * its key, words, icon, whether it destroys (danger), and what it does.
 */
export interface GridColumnAction {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  readonly isDanger?: boolean;
  readonly onAction: () => void;
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
  /** The rows are sorted by this column, this way: `aria-sort`, and the direction's arrow after the name. */
  readonly sorted?: 'ascending' | 'descending';
  /** A dragged column is over this one and would land on this side of it. */
  readonly dropSide?: 'before' | 'after' | undefined;
}

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
  sorted,
  dropSide,
}: GridHeaderCellProps) {
  const { attribute } = column;
  // Pointer drag only: the column menu is the keyboard route, so the header's keys stay the grid's.
  const { bind, isDragging, isOver, onPointerDown } = useDragTarget(column.id, { isDisabled: isRowHeader });

  const onAction = (key: string) => {
    const extra = actions.extra?.find((item) => `extra:${item.id}` === key);
    if (extra !== undefined) {
      extra.onAction();
      return;
    }
    if (key === 'left') actions.onMove(-1);
    else if (key === 'right') actions.onMove(1);
    else if (key === 'pin') actions.onPin();
    else if (key === 'unpin') actions.onUnpin();
    else if (key === 'hide') actions.onHide();
    else if (key === 'ascending' || key === 'descending') actions.onSort?.(key);
    else if (key === 'filter') actions.onFilter?.();
    else if (key === 'resize') actions.onStartResize();
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
      ref={bind}
      role="columnheader"
      aria-colindex={place.col + 1}
      aria-sort={sorted}
      className={styles.root}
      data-cell={`-1:${String(place.col)}`}
      data-focused={isFocused || undefined}
      data-sticky={place.stickyOffset === undefined ? undefined : ''}
      data-last-pinned={place.isLastPinned === true ? '' : undefined}
      data-drags={isRowHeader ? undefined : ''}
      data-dragging={isDragging || undefined}
      data-drop-target={isOver ? dropSide : undefined}
      data-resizing={isResizing || undefined}
      data-align={fieldTypeOf(attribute.type).align}
      tabIndex={isFocused ? 0 : -1}
      style={{ '--col-width': `${String(place.width)}px`, '--col-offset': `${String(place.stickyOffset ?? 0)}px` }}
      onPointerDown={onPointerDown}
    >
      <Icon name={iconOf(attribute)} size="sm" tone="muted" />
      <span className={styles.name}>
        {/* While resizing, the keys are on show, and the grid announces the width. */}
        <Tooltip content={strings.resizeHint} isTextTrigger isOpen={isResizing}>
          <TruncatedText>{attribute.name}</TruncatedText>
        </Tooltip>
      </span>
      {/* Decorative: aria-sort says it to screen readers. */}
      {sorted !== undefined && (
        <Icon
          name={sorted === 'ascending' ? 'arrow-up-narrow-wide' : 'arrow-down-wide-narrow'}
          size="sm"
          tone="muted"
        />
      )}
      {attribute.computed !== undefined && (
        <Icon name="square-function" size="sm" tone="muted" label={strings.computedColumn} />
      )}
      {attribute.ai !== undefined && <Icon name="sparkles" size="sm" tone="ai" label={strings.aiColumn} />}
      {/* Its cells never open: said once here, so the column doesn't look editable. */}
      {readOnlyReasonOf(attribute) !== undefined && (
        <Icon name="lock" size="xs" tone="muted" label={strings.readOnlyColumn} />
      )}
      <MenuTrigger isOpen={isMenuOpen} onOpenChange={onMenuOpenChange}>
        <Button variant="ghost" icon="chevron-down" label={strings.columnOptions(attribute.name)} />
        <Menu<object>
          label={strings.columnOptions(attribute.name)}
          // Its end on the chevron's, so the menu sits under this column, not over the next.
          placement="bottom end"
          onAction={(key) => {
            onAction(String(key));
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
            <MenuItem id="ascending" icon="arrow-up-narrow-wide" isChecked={sorted === 'ascending'}>
              {strings.sortAscending}
            </MenuItem>
          )}
          {actions.onSort !== undefined && (
            <MenuItem id="descending" icon="arrow-down-wide-narrow" isChecked={sorted === 'descending'}>
              {strings.sortDescending}
            </MenuItem>
          )}
          {actions.onFilter !== undefined && (
            <MenuItem id="filter" icon="list-filter">
              {strings.filter}
            </MenuItem>
          )}
          {actions.extra !== undefined && actions.extra.length > 0 && <MenuSeparator />}
          {actions.extra?.map((item) => (
            <MenuItem key={item.id} id={`extra:${item.id}`} icon={item.icon} isDanger={item.isDanger === true}>
              {item.label}
            </MenuItem>
          ))}
        </Menu>
      </MenuTrigger>
      <span className={styles.resize} aria-hidden="true" onPointerDown={startResize} />
    </div>
  );
}

/** The lifted copy of a header that follows the pointer while a column moves: its type's icon and name. */
export function GridHeaderGhost({ attribute }: { readonly attribute: GridColumn['attribute'] }) {
  return (
    <div className={styles.ghost}>
      <Icon name={iconOf(attribute)} size="sm" tone="muted" />
      <span className={styles.name}>
        <TruncatedText>{attribute.name}</TruncatedText>
      </span>
    </div>
  );
}

/** What a screen reader hears while a column moves by pointer (the column menu is the keyboard route). */
export function columnWords(nameOf: (id: string) => string): DragWords {
  return {
    lifted: (id) => strings.columnLifted(nameOf(id)),
    over: (id, drop) =>
      drop?.overId === undefined || drop.overId === id
        ? undefined
        : strings.columnOver(nameOf(id), nameOf(drop.overId)),
    dropped: (id, drop) =>
      drop?.overId === undefined || drop.overId === id
        ? strings.columnPutBack(nameOf(id))
        : strings.columnDropped(nameOf(id)),
    cancelled: (id) => strings.columnPutBack(nameOf(id)),
    moving: (id) => strings.columnLifted(nameOf(id)),
  };
}
