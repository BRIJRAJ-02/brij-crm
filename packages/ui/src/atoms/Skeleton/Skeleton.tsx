import styles from './Skeleton.module.css';

/**
 * `line` for a row of text (the default), `text` for a row of text that holds
 * the text's own line box, `circle` for an avatar, `tile` for an icon tile,
 * `block` for a card or a chart, `field` for a field or a Select at a settings
 * row's end, `fill` for a placeholder that takes the whole slot it sits in.
 */
export type SkeletonShape = 'line' | 'text' | 'circle' | 'tile' | 'block' | 'field' | 'fill';

/** How much of its slot a line fills: `full` (the default), `long` (80%), `medium` (60%) or `short` (40%). A field is a menu wide unless given one. */
export type SkeletonWidth = 'full' | 'long' | 'medium' | 'short';

/** Where a column of `lines` sits: `start` (the default) under left aligned text, `center` under centred text. */
export type SkeletonAlign = 'start' | 'center';

/** For `circle`: which avatar it stands in for, from the avatar scale. A chip when left out. */
export type SkeletonSize = 'xs' | 'sm' | 'md' | 'lg' | 'title' | 'xl';

/** The shapes a `lines` count repeats: the rest draw once. */
const REPEATABLE: readonly SkeletonShape[] = ['line', 'text'];

/** Props for Skeleton. */
export interface SkeletonProps {
  readonly shape?: SkeletonShape;
  readonly width?: SkeletonWidth;
  /** Several rows of text, the last one shorter. `line` and `text` only. */
  readonly lines?: number;
  /** Where the lines sit, matching the text they stand in for: `center` under a centred title (EmptyState). Lines only. */
  readonly align?: SkeletonAlign;
  /** For `circle`: the avatar size it stands in for, so a loading face is the size the face will be. */
  readonly size?: SkeletonSize;
  /**
   * Draws the shape without the pulse: a sketch of content, not content on
   * its way (first run's workspace preview), so it never reads as loading.
   */
  readonly isStill?: boolean;
}

/**
 * Stands in for content still loading, in its shape, and pulses slowly. It is
 * hidden from screen readers: the region it sits in says it is busy. Show it
 * through `useDelayedLoading`, so it never flashes for a fast load.
 */
export function Skeleton({ shape = 'line', width, lines = 1, align = 'start', size, isStill = false }: SkeletonProps) {
  const still = isStill ? '' : undefined;
  if (lines > 1 && REPEATABLE.includes(shape)) {
    return (
      <span
        className={styles.lines}
        data-shape={shape}
        data-align={align === 'start' ? undefined : align}
        aria-hidden="true"
      >
        {Array.from({ length: lines }, (_, index) => (
          <span
            key={index}
            className={styles.root}
            data-shape={shape}
            data-width={index === lines - 1 ? 'medium' : width}
            data-still={still}
          />
        ))}
      </span>
    );
  }
  return (
    <span
      className={styles.root}
      data-shape={shape}
      data-width={width}
      data-size={size}
      data-still={still}
      aria-hidden="true"
    />
  );
}
