import styles from './Skeleton.module.css';

/** `line` for a row of text (the default), `circle` for an avatar, `block` for a card or a chart. */
export type SkeletonShape = 'line' | 'circle' | 'block';

/** How much of its slot a line fills: `full`, `long` (80%), `medium` (60%) or `short` (40%). */
export type SkeletonWidth = 'full' | 'long' | 'medium' | 'short';

/** Props for Skeleton. */
export interface SkeletonProps {
  readonly shape?: SkeletonShape;
  readonly width?: SkeletonWidth;
  /** Several lines of text, the last one shorter. Lines only. */
  readonly lines?: number;
}

/**
 * Stands in for content still loading, in its shape, and pulses slowly. It is
 * hidden from screen readers: the region it sits in says it is busy. Show it
 * through `useDelayedLoading`, so it never flashes for a fast load.
 */
export function Skeleton({ shape = 'line', width = 'full', lines = 1 }: SkeletonProps) {
  if (shape === 'line' && lines > 1) {
    return (
      <span className={styles.lines} aria-hidden="true">
        {Array.from({ length: lines }, (_, index) => (
          <span
            key={index}
            className={styles.root}
            data-shape="line"
            data-width={index === lines - 1 ? 'medium' : width}
          />
        ))}
      </span>
    );
  }
  return <span className={styles.root} data-shape={shape} data-width={width} aria-hidden="true" />;
}
