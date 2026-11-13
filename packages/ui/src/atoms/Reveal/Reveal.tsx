import { useState, type ReactNode } from 'react';
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
  /**
   * `entrance` (the default): a public page's words rising out of a soft blur, as above. `drop` (spec 0073, AC-7311,
   * the prototype's DropIn): a row arriving in a list (a comment, a task, a booking that just came in) opens from no
   * height while it rises, with no blur, so it is allowed in the app. `order` and `display` don't apply to it.
   */
  readonly variant?: 'entrance' | 'drop';
  /** For `drop`: `false` for rows that were there on load, which simply sit in place. */
  readonly animate?: boolean;
}

/**
 * A public page's entrance, played once as it first draws (spec 0068, AC-6803, AC-6806): what it wraps rises a
 * short way out of a soft blur, its place in the run one stagger after the place before. CSS alone, so it costs no
 * script and never replays on a re-render; under reduced motion it is simply there. The entrance is for public pages
 * only (the app never moves its text in); `drop` is the app's one row arrival.
 */
export function Reveal({ order = 1, display = 'block', variant = 'entrance', animate = true, children }: RevealProps) {
  if (variant === 'drop') return <DropRow animate={animate}>{children}</DropRow>;
  return (
    <span className={styles.root} data-order={order} data-display={display}>
      {children}
    </span>
  );
}

/**
 * Reveal's `drop`: the row is clipped only while it opens, so a focus ring inside it is never cut once it is in.
 * Where no animation runs (reduced motion, a row there on load), it is never clipped.
 */
function DropRow({ animate, children }: { readonly animate: boolean; readonly children: ReactNode }) {
  const [isOpening, setOpening] = useState(animate);
  return (
    <div
      className={styles.drop}
      data-still={animate ? undefined : ''}
      data-opening={isOpening || undefined}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) setOpening(false);
      }}
    >
      <div className={styles.dropInner}>{children}</div>
    </div>
  );
}
