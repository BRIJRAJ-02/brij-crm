import styles from './Skeleton.module.css';

/** `line` for a row of text (the default), `circle` for an avatar, `tile` for an icon tile, `block` for a card or a chart. */
export type SkeletonShape = 'line' | 'circle' | 'tile' | 'block';

/** How much of its slot a line fills: `full`, `long` (80%), `medium` (60%) or `short` (40%). */
export type SkeletonWidth = 'full' | 'long' | 'medium' | 'short';

/** Where a column of `lines` sits: `start` (the default) under left aligned text, `center` under centred text. */
export type SkeletonAlign = 'start' | 'center';

/** Props for Skeleton. */
export interface SkeletonProps {
  readonly shape?: SkeletonShape;
  readonly width?: SkeletonWidth;
  /** Several lines of text, the last one shorter. Lines only. */
  readonly lines?: number;
  /** Where the lines sit, matching the text they stand in for: `center` under a centred title (EmptyState). Lines only. */
  readonly align?: SkeletonAlign;
}

/**
 * Stands in for content still loading, in its shape, and pulses slowly. It is
 * hidden from screen readers: the region it sits in says it is busy. Show it
 * through `useDelayedLoading`, so it never flashes for a fast load.
 */
export function Skeleton({ shape = 'line', width = 'full', lines = 1, align = 'start' }: SkeletonProps) {
  if (shape === 'line' && lines > 1) {
    return (
      <span className={styles.lines} data-align={align === 'start' ? undefined : align} aria-hidden="true">
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
