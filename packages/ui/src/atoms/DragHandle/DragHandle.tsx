import { Button as AriaButton } from 'react-aria-components';
import { Icon } from '../Icon/Icon.tsx';
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden.tsx';
import styles from './DragHandle.module.css';

/** Props for DragHandle. */
export interface DragHandleProps {
  /** What moving it does, named for screen readers: "Move Stage". */
  readonly label: string;
  /**
   * The row can't move. The handle stays in the row for React Aria (which asks
   * every draggable row for one) but is hidden and out of the tab order.
   */
  readonly isDisabled?: boolean;
}

/**
 * The grip a row or card is moved by, inside a React Aria GridList with drag
 * and drop: it fills the `drag` slot, so Enter on it picks the row up. Rows
 * that sort (sorts, view fields, board cards) all use this one handle.
 */
export function DragHandle({ label, isDisabled = false }: DragHandleProps) {
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
