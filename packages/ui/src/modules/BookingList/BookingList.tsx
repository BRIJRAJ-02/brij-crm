import type { ReactNode } from 'react';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { Link } from '../../atoms/Link/Link.tsx';
import styles from './BookingList.module.css';
import { strings } from './strings.ts';

/** One booking's row. */
export interface BookingListRow {
  readonly id: string;
  /** The day, bold in the date column ("Mon, 28 Apr"). */
  readonly date: string;
  /** The time, muted under it ("9:00 – 9:30 AM"). */
  readonly time: string;
  /** The meeting's link and who provides it ("Google Meet"), once the event has one. */
  readonly join?: { readonly href: string; readonly provider: string };
  /** The meeting's title: what opens the booking. */
  readonly title: string;
  /** The visitor's note, quoted and cut to one line. */
  readonly note?: string;
  /** The visitor's name, after "You and", linked to their person when `guestHref` is given. */
  readonly guestName: string;
  readonly guestHref?: string;
  /** A state worth saying ("Cancelled"). */
  readonly badge?: string;
  /** The row's actions at its end (Cancel, an Edit menu). */
  readonly actions?: ReactNode;
}

/** One day's band and its rows. */
export interface BookingListGroup {
  readonly id: string;
  /** The band's label ("Today", "Wed, 21 Oct"), shown in small capitals. */
  readonly label: string;
  readonly rows: readonly BookingListRow[];
}

/** Props for BookingList. */
export interface BookingListProps {
  /** What the list is ("Upcoming bookings"). */
  readonly label: string;
  readonly groups: readonly BookingListGroup[];
  /** Opens a booking (its title is the button). */
  readonly onOpen: (id: string) => void;
  /** Shown with no rows: the tab's own EmptyState. */
  readonly emptyState?: ReactNode;
}

/**
 * Bookings as rows under day bands (spec 0025, the Cal.com alignment, 5.
 * Bookings list): a date column with the day in bold, the time muted and the
 * meeting's Join link; the title (a button that opens it), the visitor's note
 * and "You and <guest>"; and the row's actions at the end.
 */
export function BookingList({ label, groups, onOpen, emptyState }: BookingListProps) {
  if (groups.every((group) => group.rows.length === 0)) return <>{emptyState}</>;
  return (
    <section className={styles.root} aria-label={label}>
      {groups.map((group) => (
        <div key={group.id} className={styles.group}>
          <h3 className={styles.band}>{group.label}</h3>
          <ul className={styles.rows} aria-label={group.label}>
            {group.rows.map((row) => (
              <li key={row.id} className={styles.row}>
                <div className={styles.when}>
                  <span className={styles.date}>{row.date}</span>
                  <span className={styles.time}>{row.time}</span>
                  {row.join !== undefined && (
                    <span className={styles.join}>
                      <Icon name="video" size="sm" />
                      <Link href={row.join.href}>{strings.join(row.join.provider)}</Link>
                    </span>
                  )}
                </div>
                <div className={styles.main}>
                  <div className={styles.titleLine}>
                    <Button variant="ghost" onPress={() => onOpen(row.id)}>
                      {row.title}
                    </Button>
                    {row.badge !== undefined && <Badge text={row.badge} />}
                  </div>
                  {row.note !== undefined && <span className={styles.note}>{strings.quoted(row.note)}</span>}
                  <span className={styles.who}>
                    {strings.youAnd}{' '}
                    {row.guestHref === undefined ? row.guestName : <Link href={row.guestHref}>{row.guestName}</Link>}
                  </span>
                </div>
                {row.actions !== undefined && <div className={styles.actions}>{row.actions}</div>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
