import { useState, type ReactNode } from 'react';
import styles from './RevealDrop.module.css';

/** Props for RevealDrop. */
export interface RevealDropProps {
  /** `false` for rows that were there on load, which simply sit in place. */
  readonly animate?: boolean;
  readonly children: ReactNode;
}

/**
 * A row arriving in a list (a comment, a task, a booking that just came in; spec 0073, AC-7311, the prototype's
 * DropIn): it opens from no height while it rises, with no blur, so it is the app's one row arrival. The row is
 * clipped only while it opens, so a focus ring inside it is never cut once it is in; where no animation runs (reduced
 * motion, a row there on load), it is never clipped. Reveal's sibling in its own file, so a public page drawing
 * Reveal's entrance carries none of it.
 */
export function RevealDrop({ animate = true, children }: RevealDropProps) {
  const [isOpening, setOpening] = useState(animate);
  return (
    <div
      className={styles.root}
      data-still={animate ? undefined : ''}
      data-opening={isOpening || undefined}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) setOpening(false);
      }}
    >
      <div className={styles.inner}>{children}</div>
    </div>
  );
}
