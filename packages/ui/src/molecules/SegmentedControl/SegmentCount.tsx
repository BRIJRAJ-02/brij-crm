import { useState } from 'react';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import styles from './SegmentCount.module.css';

/**
 * A segment's quiet count, loaded by SegmentedControl with the first segment that has one. Keyed by the number, so a
 * new one rolls in rather than swapping in place; the first number it shows just sits there (no roll as the page or
 * its count first loads).
 */
export function SegmentCount({ count }: { readonly count: number }) {
  const [first] = useState(count);
  return (
    <span className={styles.count}>
      <VisuallyHidden>, </VisuallyHidden>
      <span key={count} className={styles.countValue} data-roll={count === first ? undefined : ''}>
        {count}
      </span>
    </span>
  );
}
