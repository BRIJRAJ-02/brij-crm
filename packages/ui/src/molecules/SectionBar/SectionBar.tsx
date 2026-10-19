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
}

/**
 * One row of controls above a section of a page (Bookings' calendar and
 * list, spec 0025): what comes first, the heading, then what sits at the end;
 * it wraps on a narrow container, the end controls under the rest.
 */
export function SectionBar({ title, start, end }: SectionBarProps) {
  return (
    <div className={styles.root}>
      {start !== undefined && <div className={styles.group}>{start}</div>}
      {title !== undefined && <h2 className={styles.title}>{title}</h2>}
      {end !== undefined && <div className={styles.end}>{end}</div>}
    </div>
  );
}
