import { useEffect, useState } from 'react';
import { useReducedMotion } from '../../lib/motion/motion.ts';
import { durationToken } from '../../lib/token-values.ts';
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden.tsx';
import styles from './RollingNumber.module.css';

/** How long the count waits after the edit that fed it, so the edit is seen first and the count answers it. */
const BEAT_MS = durationToken('duration-press');

/** How long the roll itself lasts, after which the count is one piece of text again. */
const ROLL_MS = durationToken('duration-move');

/** Props for RollingNumber. */
export interface RollingNumberProps {
  /** The count to show, already formatted by the caller when it needs grouping or a cap ("1,284", "99+"). */
  readonly children: string | number;
}

/** The characters of a count, so only the ones that changed are rolled. One match per code point, whatever the language's digits are. */
function charsOf(value: string): readonly string[] {
  return value.match(/./gu) ?? [];
}

/**
 * A count that rolls only the characters that changed, a beat after the edit
 * that fed it. Everything else holds still, so the eye lands on what moved.
 * Between rolls the count is one piece of text, as any other count is.
 */
export function RollingNumber({ children }: RollingNumberProps) {
  const isStill = useReducedMotion();
  const [shown, setShown] = useState(() => String(children));
  const [rolled, setRolled] = useState<readonly boolean[]>([]);
  const next = String(children);
  // Which characters the roll in flight is moving; empty between rolls, when the count is plain text again.
  const isRolling = rolled.length > 0;

  useEffect(() => {
    if (shown === next) return;
    // A count arriving is not a count changing: a list draws 0 while it counts, and the real number landing
    // must not slot-machine every count on the screen at once.
    const wasPlaceholder = shown === '' || shown === '0';
    const beat = setTimeout(
      () => {
        setShown(next);
        if (isStill || wasPlaceholder) return;
        const was = charsOf(shown);
        setRolled(charsOf(next).map((char, index) => char !== was[index]));
      },
      isStill || wasPlaceholder ? 0 : BEAT_MS,
    );
    return () => {
      clearTimeout(beat);
    };
  }, [next, shown, isStill]);

  useEffect(() => {
    if (!isRolling) return;
    const settle = setTimeout(() => {
      setRolled([]);
    }, ROLL_MS);
    return () => {
      clearTimeout(settle);
    };
  }, [isRolling, shown]);

  if (!isRolling || isStill) {
    return <span className={styles.root}>{shown}</span>;
  }
  return (
    <span className={styles.root}>
      {/* While it rolls the characters are drawn, not spoken: the whole count sits beside them, said once. */}
      <span aria-hidden="true">
        {charsOf(shown).map((char, index) => (
          <span key={`${String(index)}-${char}`} className={styles.char} data-rolled={rolled[index] || undefined}>
            {char}
          </span>
        ))}
      </span>
      <VisuallyHidden>{shown}</VisuallyHidden>
    </span>
  );
}
