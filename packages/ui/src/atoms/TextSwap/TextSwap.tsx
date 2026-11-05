import { useEffect, useState } from 'react';
import styles from './TextSwap.module.css';

/** Props for TextSwap. */
export interface TextSwapProps {
  /** The words it shows ("Publish", then "Published"). A change plays the swap; the first value is simply there. */
  readonly children: string;
}

/**
 * Words that change in place (spec 0068, AC-6806: Publish → Published, Book → Booked, Add → Added): the old words
 * rise out a short way and fade in the exit duration, then the new words rise in from below and fade in (transitions.dev's text states swap). Both share one cell while they cross, so the wider sets the width and
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
  // The exit's end takes the old words away; where no animation runs to its end (a tab in the background pauses
  // them), they go after a second anyway, so two labels never stay drawn over each other.
  useEffect(() => {
    if (state.gone === undefined) return undefined;
    const round = state.round;
    const timer = globalThis.setTimeout(() => {
      setState((was) => (was.round === round ? { ...was, gone: undefined } : was));
    }, 1_000);
    return () => globalThis.clearTimeout(timer);
  }, [state.gone, state.round]);
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
