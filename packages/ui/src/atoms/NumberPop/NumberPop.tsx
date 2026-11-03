import { useState } from 'react';
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden.tsx';
import styles from './NumberPop.module.css';

/** Props for NumberPop. */
export interface NumberPopProps {
  /** What it shows, already worded ("3", "£45", "42 going"): the caller formats, this only moves. */
  readonly value: string;
}

/** How many leading characters two values share. */
export function sharedStart(before: string, after: string): number {
  let same = 0;
  while (same < before.length && same < after.length && before[same] === after[same]) same += 1;
  return same;
}

/**
 * A number that pops its changed digits in (spec 0068, AC-6806: prices, totals, "42 going", a count of changes):
 * when `value` changes, the characters it shares with the last value at the start stay still and the rest rise in
 * out of a soft blur, the last two a stagger behind (transitions.dev's number pop in). The first value is simply
 * there. Screen readers read the whole value once, never digit by digit; reduced motion swaps it at once.
 */
export function NumberPop({ value }: NumberPopProps) {
  // The last value drawn and how many times it changed: a changed character takes a new key, so it mounts afresh
  // and plays its entrance; a shared one keeps its key and holds still.
  const [shown, setShown] = useState({ value, round: 0, same: value.length });
  if (shown.value !== value) setShown({ value, round: shown.round + 1, same: sharedStart(shown.value, value) });
  const { round, same } =
    shown.value === value ? shown : { round: shown.round + 1, same: sharedStart(shown.value, value) };
  // Code points: a price or a count is digits, a currency mark and words, never a joined emoji.
  const characters = Array.from(value);
  return (
    <span className={styles.root}>
      <span className={styles.digits} aria-hidden="true">
        {characters.map((character, index) => {
          const isSame = index < same;
          const fromEnd = characters.length - 1 - index;
          return (
            <span
              key={isSame ? `same-${String(index)}` : `new-${String(round)}-${String(index)}`}
              className={styles.digit}
              data-same={isSame || undefined}
              data-stagger={isSame ? undefined : fromEnd < 2 ? 2 - fromEnd : undefined}
            >
              {character}
            </span>
          );
        })}
      </span>
      <VisuallyHidden>{value}</VisuallyHidden>
    </span>
  );
}
