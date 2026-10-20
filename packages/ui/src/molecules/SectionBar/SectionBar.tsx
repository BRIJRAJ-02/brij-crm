import type { ReactNode } from 'react';
import styles from './SectionBar.module.css';

/** Props for SectionBar. */
export interface SectionBarProps {
  /** The section's heading ("19 – 25 October 2026"), an h2. */
  readonly title?: string;
  /** Controls before the heading (a view switch). */
  readonly start?: ReactNode;
  /** Controls at the end (previous, Today, next, Filter). */
  readonly end?: ReactNode;
  /**
   * `inline` (the default) sits inside a section; `bar` draws it as a page's
   * bar under the TopBar (the toolbar's height, padding and edge), for
   * controls that keep their own arrow keys, such as SegmentedControls (My
   * tasks), which Toolbar's arrow key roving would take over.
   */
  readonly variant?: SectionBarVariant;
}

/** Where a SectionBar sits. */
export type SectionBarVariant = 'inline' | 'bar';

/**
 * One row of controls above a section of a page (Bookings' calendar and
 * list, spec 0025): what comes first, the heading, then what sits at the end;
 * it wraps on a narrow container, the end controls under the rest.
 */
export function SectionBar({ title, start, end, variant = 'inline' }: SectionBarProps) {
  return (
    <div className={styles.root} data-variant={variant === 'bar' ? 'bar' : undefined}>
      {start !== undefined && <div className={styles.group}>{start}</div>}
      {title !== undefined && <h2 className={styles.title}>{title}</h2>}
      {end !== undefined && <div className={styles.end}>{end}</div>}
    </div>
  );
}
