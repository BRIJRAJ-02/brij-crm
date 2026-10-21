import type { KeyboardEvent, PointerEvent } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { Icon } from '../Icon/Icon.tsx';
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden.tsx';
import styles from './DragHandle.module.css';

/**
 * The handle driving the move itself, outside a React Aria GridList (the
 * sidebar's sections, spec 0034): the list keeps the order and the
 * announcements, and hands the handle its keys and pointer.
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
  /**
   * The row can't move. The handle stays in the row for React Aria (which asks
   * every draggable row for one) but is hidden and out of the tab order.
   */
  readonly isDisabled?: boolean;
  /** Outside a GridList: the list hands the handle its keys and pointer (see `DragHandleManual`). */
  readonly manual?: DragHandleManual;
}

/**
 * The grip a row or card is moved by. Inside a React Aria GridList with drag
 * and drop it fills the `drag` slot, so Enter on it picks the row up; rows
 * that sort (sorts, view fields, board cards) all use this one handle. With
 * `manual`, a list that isn't a grid (the sidebar) drives it itself.
 */
export function DragHandle({ label, isDisabled = false, manual }: DragHandleProps) {
  if (manual !== undefined) {
    return (
      // A plain button: React Aria's press handling would swallow the pointer down the list needs to start a drag.
      <button
        type="button"
        className={styles.root}
        aria-label={label}
        aria-pressed={manual.isLifted}
        {...(manual.describedBy === undefined ? {} : { 'aria-describedby': manual.describedBy })}
        data-manual=""
        data-lifted={manual.isLifted || undefined}
        onKeyDown={manual.onKeyDown}
        onPointerDown={manual.onPointerDown}
        onBlur={manual.onBlur}
      >
        <Icon name="grip-vertical" size="sm" />
      </button>
    );
  }
  if (isDisabled) {
    return (
      <VisuallyHidden>
        <AriaButton slot="drag" isDisabled aria-hidden="true" />
      </VisuallyHidden>
    );
  }
  return (
    <AriaButton slot="drag" className={styles.root} aria-label={label}>
      <Icon name="grip-vertical" size="sm" />
    </AriaButton>
  );
}
