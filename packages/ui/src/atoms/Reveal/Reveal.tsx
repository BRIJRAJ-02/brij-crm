import type { ReactNode } from 'react';
import styles from './Reveal.module.css';

/** Props for Reveal. */
export interface RevealProps {
  /**
   * Its place in the run (1 to 6): each place starts one stagger later than the one before, so a headline lands
   * before the line under it and the rows after both (transitions.dev's texts reveal).
   */
  readonly order?: 1 | 2 | 3 | 4 | 5 | 6;
  /** `block` (the default) stands on its own line; `inline` stays in the line it is in (a word in a heading). */
  readonly display?: 'block' | 'inline';
  readonly children: ReactNode;
}

/**
 * A public page's entrance, played once as it first draws (spec 0068, AC-6803, AC-6806): what it wraps rises a
 * short way out of a soft blur, its place in the run one stagger after the place before. CSS alone, so it costs no
 * script and never replays on a re-render; under reduced motion it is simply there. For public pages only: the app
 * never moves its text in.
 */
export function Reveal({ order = 1, display = 'block', children }: RevealProps) {
  return (
    <span className={styles.root} data-order={order} data-display={display}>
      {children}
    </span>
  );
}
