import { useId, type MouseEvent, type ReactNode } from 'react';
import { Badge, type BadgeTone } from '../../atoms/Badge/Badge.tsx';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { Link } from '../../atoms/Link/Link.tsx';
import { StatusDot } from '../../atoms/StatusDot/StatusDot.tsx';
import type { Hue } from '../../hue.ts';
import styles from './BookingList.module.css';
import { strings } from './strings.ts';

/** One booking's row. */
export interface BookingListRow {
  readonly id: string;
  /** The day, bold in the date column ("Mon, 28 Apr"). */
  readonly date: string;
  /** The time, muted under it ("9:00 – 9:30 AM"); empty draws nothing (an all day event). */
  readonly time: string;
  /** The meeting's link and who provides it ("Google Meet"), once the event has one. */
  readonly join?: { readonly href: string; readonly provider: string };
  /** The meeting's title: what opens the booking. */
  readonly title: string;
  /** The visitor's note, quoted and cut to one line. */
  readonly note?: string;
  /**
   * The visitor's name, after "You and", linked to their person when `guestHref` is given. Left out for one
   * of the member's own calendar events (Home's Today), which has no visitor: the row has no "You and" line.
   */
  readonly guestName?: string;
  /** Who hosts it, when that isn't the reader: "Sam Lee and <guest>" in place of "You and". */
  readonly hostName?: string;
  /** The guest's person page; only read with `guestName` (a row with no guest links nobody). */
  readonly guestHref?: string;
  /** Who else is in it, as chips (a calendar event's attendees, a booking's guests), and how many more. */
  readonly attendees?: readonly string[];
  readonly moreAttendees?: number;
  /** The calendar it is on, by its colour and name (a synced calendar event). */
  readonly calendar?: { readonly name: string; readonly hue: Hue };
  /** A state worth saying ("Cancelled"). */
  readonly badge?: string;
  /** `accent` for a state that asks for action ("Needs a host"); `neutral`, the default, for one that only says. */
  readonly badgeTone?: BadgeTone;
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
  /**
   * `page` (the default) draws the list in its own bordered box (Bookings' list). `card` leaves the box to the
   * Card around it (Home's Today): rows inset, bands kept, a narrower date column for a time alone.
   */
  readonly placement?: 'page' | 'card';
}

/** Whether a row has anything for its second line. */
const hasDetails = (row: BookingListRow) =>
  row.join !== undefined ||
  row.calendar !== undefined ||
  row.guestName !== undefined ||
  (row.attendees !== undefined && row.attendees.length > 0) ||
  row.note !== undefined;

/** What a press inside a row may land on that is its own control: a press there is that control's, not the row's. */
const CONTROL = 'a, button, input, select, textarea, [role="button"], [role="link"]';

/**
 * Opens the row on a press anywhere in it that isn't one of its own controls (the guest link, Join, the actions)
 * or the end of a text selection: the title button stays the keyboard's way in, so this adds a bigger target for
 * a pointer only.
 */
function openOnPress(event: MouseEvent<HTMLElement>, open: () => void) {
  const target = event.target instanceof Element ? event.target : null;
  if (target === null || target.closest(CONTROL) !== null) return;
  if ((window.getSelection()?.toString() ?? '') !== '') return;
  open();
}

/**
 * Bookings as rows under day bands (spec 0025, the Cal.com alignment, 5.
 * Bookings list), two lines a row: a date column with the day in bold over the
 * time; the title (a button that opens it) over one muted line of the rest
 * (Join, calendar, where it came from, who, the note); and the row's actions
 * at the end.
 */
export function BookingList({ label, groups, onOpen, emptyState, placement = 'page' }: BookingListProps) {
  const id = useId();
  if (groups.every((group) => group.rows.length === 0)) return <>{emptyState}</>;
  return (
    <section className={styles.root} aria-label={label} data-placement={placement === 'card' ? placement : undefined}>
      {groups.map((group, groupIndex) => (
        <div key={group.id} className={styles.group}>
          <h3 className={styles.band}>{group.label}</h3>
          <ul className={styles.rows} aria-label={group.label}>
            {group.rows.map((row, rowIndex) => {
              const rowId = `${id}-${String(groupIndex)}-${String(rowIndex)}`;
              return (
                // The title button is the row's way in by keyboard; a press anywhere else on the row opens it too.
                // eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-noninteractive-element-interactions
                <li
                  key={row.id}
                  className={styles.row}
                  data-pressable=""
                  onClick={(event) => openOnPress(event, () => onOpen(row.id))}
                >
                  <div className={styles.when} id={`${rowId}-when`}>
                    <span className={styles.date}>{row.date}</span>
                    {row.time !== '' && <span className={styles.time}>{row.time}</span>}
                  </div>
                  <div className={styles.main}>
                    <div className={styles.titleLine}>
                      {/* Named by its title, then described by its time and who it is with, so each row's button
                        says which meeting it opens. */}
                      <Button
                        variant="ghost"
                        aria-describedby={hasDetails(row) ? `${rowId}-when ${rowId}-details` : `${rowId}-when`}
                        onPress={() => onOpen(row.id)}
                      >
                        {row.title}
                      </Button>
                      {row.badge !== undefined && <Badge text={row.badge} tone={row.badgeTone ?? 'neutral'} />}
                    </div>
                    {hasDetails(row) && (
                      // Everything else on one muted line: Join first so it never gets cut off, then who, then the rest.
                      <div className={styles.details} id={`${rowId}-details`}>
                        {row.join !== undefined && (
                          <span className={styles.join}>
                            <Icon name="video" size="sm" />
                            <Link href={row.join.href}>{strings.join(row.join.provider)}</Link>
                          </span>
                        )}
                        {row.guestName !== undefined && (
                          <span className={`${styles.text} ${styles.who}`}>
                            {row.hostName === undefined ? strings.youAnd : strings.hostAnd(row.hostName)}{' '}
                            {row.guestHref === undefined ? (
                              row.guestName
                            ) : (
                              <Link href={row.guestHref}>{row.guestName}</Link>
                            )}
                          </span>
                        )}
                        {row.calendar !== undefined && (
                          <span className={styles.text}>
                            <StatusDot hue={row.calendar.hue}>{row.calendar.name}</StatusDot>
                          </span>
                        )}
                        {row.attendees !== undefined && row.attendees.length > 0 && (
                          <span className={styles.text}>
                            {strings.attendeesLine(row.attendees, row.moreAttendees ?? 0)}
                          </span>
                        )}
                        {row.note !== undefined && <span className={styles.text}>{strings.quoted(row.note)}</span>}
                      </div>
                    )}
                  </div>
                  {row.actions !== undefined && <div className={styles.actions}>{row.actions}</div>}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
