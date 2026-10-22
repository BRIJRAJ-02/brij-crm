import type { KeyboardEvent, PointerEvent } from 'react';
import type { DragGrip } from '../../lib/drag/drag.tsx';
import { Icon } from '../Icon/Icon.tsx';
import styles from './DragHandle.module.css';

/**
 * The handle driving the move itself, outside the drag wrapper (the
 * sidebar's sections, spec 0034, which move one at a time among siblings no
 * single list holds): the section keeps the order and the announcements, and
 * hands the handle its keys and pointer.
 */
export interface DragHandleManual {
  /** Picked up: it shows grabbing until dropped or put back. */
  readonly isLifted: boolean;
  /** Space or Enter lifts and drops, the arrows move, Esc puts it back. */
  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  /** A drag with the pointer starts here. */
  readonly onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  /** Focus left while lifted: the list puts it back. */
  readonly onBlur: () => void;
  /** The id of the text saying how to move it, for screen readers. */
  readonly describedBy?: string;
}

/** Props for DragHandle. */
export interface DragHandleProps {
  /** What moving it does, named for screen readers: "Move Stage". */
  readonly label: string;
  /** The grip of a sortable item (`useSortableItem(...).grip`): the drag wrapper lifts the item from it. */
  readonly drag?: DragGrip;
  /** Outside the drag wrapper: the list hands the handle its keys and pointer (see `DragHandleManual`). */
  readonly manual?: DragHandleManual;
  /**
   * Where the 24px hit area grows. `around` (the default) grows it evenly; `end` keeps its start on the
   * handle's and grows it toward the inline end, for a handle against an edge that clips (a settings table's
   * gutter handle, whose frame cut an even hit area to 21px).
   */
  readonly reach?: 'around' | 'end';
}

/**
 * The grip a row or card is moved by: one plain button for every list that
 * sorts (sorts, view fields, options, rules, questions, board cards, table
 * rows, the sidebar). With `drag` it is the grip of the library's drag
 * wrapper (dnd-kit); with `manual`, a list outside it drives it. A row that
 * can't move draws no grip at all.
 */
export function DragHandle({ label, drag, manual, reach = 'around' }: DragHandleProps) {
  const reachAttr = reach === 'end' ? 'end' : undefined;
  if (drag !== undefined) {
    const { bind, id, isDisabled, isLifted, describedBy, onKeyDown, onPointerDown, onClick } = drag;
    if (isDisabled) return null;
    return (
      <button
        ref={bind}
        type="button"
        className={styles.root}
        aria-label={label}
        aria-pressed={isLifted}
        {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
        data-lifted={isLifted || undefined}
        data-reach={reachAttr}
        data-drag-grip={id}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onClick={onClick}
      >
        <Icon name="grip-vertical" size="sm" />
      </button>
    );
  }
  if (manual === undefined) return null;
  return (
    <button
      type="button"
      className={styles.root}
      aria-label={label}
      aria-pressed={manual.isLifted}
      {...(manual.describedBy === undefined ? {} : { 'aria-describedby': manual.describedBy })}
      data-lifted={manual.isLifted || undefined}
      data-reach={reachAttr}
      onKeyDown={manual.onKeyDown}
      onPointerDown={manual.onPointerDown}
      onBlur={manual.onBlur}
    >
      <Icon name="grip-vertical" size="sm" />
    </button>
  );
}
