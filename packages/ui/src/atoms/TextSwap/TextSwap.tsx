import { useState } from 'react';
import styles from './TextSwap.module.css';

/** Props for TextSwap. */
export interface TextSwapProps {
  /** The words it shows ("Publish", then "Published"). A change plays the swap; the first value is simply there. */
  readonly children: string;
}

/**
 * Words that change in place (spec 0068, AC-6806: Publish → Published, Book → Booked, Add → Added): the old words
 * rise out a short way into a soft blur in the exit duration, then the new words rise in from below out of the same
 * blur (transitions.dev's text states swap). Both share one cell while they cross, so the wider sets the width and
 * nothing beside them jumps mid swap. Screen readers read the current words only; reduced motion crossfades in place.
 * Inside a Button use the Button's `animateLabel`, which draws its label through this.
 */
export function TextSwap({ children }: TextSwapProps) {
  // The words on show, the ones leaving (until their exit ends), and a count of swaps so each arrival mounts afresh.
  const [state, setState] = useState<{ readonly now: string; readonly gone?: string; readonly round: number }>({
    now: children,
    round: 0,
  });
  if (state.now !== children) setState({ now: children, gone: state.now, round: state.round + 1 });
  return (
    <span className={styles.root}>
      {state.gone === undefined ? null : (
        <span
          key={`gone-${String(state.round)}`}
          className={styles.words}
          data-leaving=""
          aria-hidden="true"
          onAnimationEnd={() => setState((was) => (was.round === state.round ? { ...was, gone: undefined } : was))}
        >
          {state.gone}
        </span>
      )}
      <span
        key={`now-${String(state.round)}`}
        className={styles.words}
        data-arriving={state.round === 0 ? undefined : ''}
      >
        {state.now}
      </span>
    </span>
  );
}
