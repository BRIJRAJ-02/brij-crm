import type { Hue } from '../../hue.ts';
import styles from './RemoteCursor.module.css';

/** Props for RemoteCursor. */
export interface RemoteCursorProps {
  /** Whose cursor it is. */
  readonly name: string;
  /** Their presence hue, the same as their avatar's. */
  readonly hue: Hue;
}

/** Where another person is typing in a shared note: a caret in their hue with their name above it. */
export function RemoteCursor({ name, hue }: RemoteCursorProps) {
  return (
    <span className={styles.root} data-hue={hue}>
      <span className={styles.flag}>{name}</span>
    </span>
  );
}
