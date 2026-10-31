import type { ReactNode } from 'react';
import styles from './SectionBar.module.css';

/** Props for SectionBar. */
export interface SectionBarProps {
  /** The section's heading ("19 – 25 October 2026"), an h2. */
  readonly title?: string;
  /**
   * One quiet line after the heading, on its baseline (Home's greeting: "Thursday, 22 October"). It wraps under
   * the heading on a narrow container.
   */
  readonly description?: string;
  /** Controls before the heading (a view switch). */
  readonly start?: ReactNode;
  /** Controls right after the heading, before the end ones (Bookings' week: its calendar switch after the dates). */
  readonly after?: ReactNode;
  /**
   * The heading in body strong rather than title type: a bar whose heading is a place in time (the week's dates)
   * rather than the section's name, so the controls lead.
   */
  readonly isTitleQuiet?: boolean;
  /**
   * The heading in heading type (18px) rather than title type: a page's own opening line over cards that carry
   * title type themselves (Home's greeting over Today), so the page reads greeting, then card titles, then body.
   */
  readonly isTitleProminent?: boolean;
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
export function SectionBar({
  title,
  description,
  start,
  after,
  isTitleQuiet = false,
  isTitleProminent = false,
  end,
  variant = 'inline',
}: SectionBarProps) {
  return (
    <div
      className={styles.root}
      data-variant={variant === 'bar' ? 'bar' : undefined}
      data-quiet-title={isTitleQuiet || undefined}
      data-prominent-title={isTitleProminent || undefined}
    >
      {start !== undefined && <div className={styles.group}>{start}</div>}
      {title !== undefined &&
        (description === undefined ? (
          <h2 className={styles.title}>{title}</h2>
        ) : (
          <div className={styles.heading}>
            <h2 className={styles.title}>{title}</h2>
            <p className={styles.description}>{description}</p>
          </div>
        ))}
      {after !== undefined && <div className={styles.group}>{after}</div>}
      {end !== undefined && <div className={styles.end}>{end}</div>}
    </div>
  );
}
