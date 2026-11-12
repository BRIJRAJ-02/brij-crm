import type { Hue } from '../../hue.ts';
import styles from './RemoteCursor.module.css';

/** Props shared by both kinds of RemoteCursor. */
interface RemoteCursorBase {
  /** Whose cursor it is. */
  readonly name: string;
  /** Their presence hue, the same as their avatar's. */
  readonly hue: Hue;
}

/** Props for RemoteCursor. */
export type RemoteCursorProps =
  | (RemoteCursorBase & {
      /** `caret` (the default): where they are typing in a shared note, a caret with their name on a flag above. */
      readonly variant?: 'caret';
    })
  | (RemoteCursorBase & {
      /**
       * `pointer` (spec 0073, AC-7309): their pointer on a shared surface (a board, a form builder), an arrow in their
       * hue with their name on a pill, placed at `x` and `y` px inside the nearest positioned ancestor. Each new point
       * glides from the last, so updates every 100 to 150 ms read as motion.
       */
      readonly variant: 'pointer';
      readonly x: number;
      readonly y: number;
      /** No movement for a while: the name folds away and the arrow dims. */
      readonly isIdle?: boolean;
    });

/**
 * Another person's place in something shared: the caret where they type, or their pointer on a canvas. Hidden from
 * screen readers (the page's presence group says who is here); it only moves by `translate`, so a stream of
 * positions costs no layout.
 */
export function RemoteCursor(props: RemoteCursorProps) {
  const { name, hue } = props;
  if (props.variant === 'pointer') {
    return (
      <span
        className={styles.pointer}
        data-hue={hue}
        data-idle={props.isIdle === true || undefined}
        aria-hidden="true"
        style={{ '--cursor-x': `${String(props.x)}px`, '--cursor-y': `${String(props.y)}px` }}
      >
        <span className={styles.arrow} />
        <span className={styles.pill}>{name}</span>
      </span>
    );
  }
  return (
    <span className={styles.root} data-hue={hue} aria-hidden="true">
      <span className={styles.flag}>{name}</span>
    </span>
  );
}
