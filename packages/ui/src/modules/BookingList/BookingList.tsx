import type { RecordRefDisplay } from '@crm/contracts/values';
import { Fragment, useId, type MouseEvent, type ReactNode } from 'react';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Badge, type BadgeTone } from '../../atoms/Badge/Badge.tsx';
import { Button, ButtonLink } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { ProviderMark, type ProviderName } from '../../atoms/ProviderMark/ProviderMark.tsx';
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
  /**
   * `columns` only: who it is with, their face before their name; the name is the row's title button, so the row keeps
   * one way in and the person's page is the meeting popup's link, not the row's.
   */
  readonly chip?: RecordRefDisplay;
  /** `columns` only: a calendar event's provider, its mark in the face's place ("google-calendar"). */
  readonly provider?: ProviderName;
  /** `columns` only: the quiet line under the name, an icon then words ("Product demo · Zoom"). */
  readonly subline?: { readonly icon?: IconName; readonly text: string };
  /** `columns` only: a state worth saying beside the name, a quiet dot and its word ("Needs a host", "No-show"). */
  readonly status?: { readonly label: string; readonly hue: Hue };
  /** `columns` only: it has ended (earlier today): its words step back. */
  readonly isDone?: boolean;
  /** `columns` only: the time now ("10:20 am"), drawn as a line above this row, between what's done and what's next. */
  readonly nowBefore?: string;
  /**
   * `columns` only: the row's quick changes (a ⋯ menu), shown while the row is hovered or holds focus, and always on a
   * touch screen; their room is kept, so nothing shifts as they show.
   */
  readonly quickActions?: ReactNode;
  /**
   * It just arrived (a guest booked while the list was open): the row washes in the accent's soft fill once, then
   * rests. Set it while it stays new; the wash plays only as the row mounts.
   */
  readonly isNew?: boolean;
}

/** One day's band and its rows. */
export interface BookingListGroup {
  readonly id: string;
  /** The band's label ("Today", "Wed, 21 Oct"), shown in small capitals. */
  readonly label: string;
  /** `columns` only: the date after a relative label, quieter ("Mon 9 Nov" after "Today"). */
  readonly sublabel?: string;
  /** `columns` only: a quiet count at the head's end, as plain grey text ("5 meetings"). */
  readonly count?: string;
  readonly rows: readonly BookingListRow[];
}

/** Props for BookingList. */
export interface BookingListProps {
  /** What the list is ("Upcoming bookings"). */
  readonly label: string;
  readonly groups: readonly BookingListGroup[];
  /**
   * Opens a booking (its title is the button), with the row it was opened from, so a screen can anchor its card there
   * (TeamDay's Needs a host lane).
   */
  readonly onOpen: (id: string, row: HTMLElement) => void;
  /** The booking whose card is open beside its row: that row shows as open, its button expanded. */
  readonly openId?: string;
  /** Shown with no rows: the tab's own EmptyState. */
  readonly emptyState?: ReactNode;
  /**
   * `page` (the default) draws the list in its own bordered box (Bookings' list). `card` leaves the box to the
   * Card around it (Home's Today): rows inset, bands kept, a narrower date column for a time alone.
   */
  readonly placement?: 'page' | 'card';
  /**
   * `stacked` (the default) is two lines a row. `columns` (Bookings › Meetings) draws each day as a card of its own
   * under a head (the day, its date, a quiet count): a row is the time over its length, who it is with (their face,
   * their name, a quiet `subline`), then Join, the `quickActions` on hover and the row's `actions`.
   */
  readonly layout?: 'stacked' | 'columns';
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
export function BookingList({
  label,
  groups,
  onOpen,
  openId,
  emptyState,
  placement = 'page',
  layout = 'stacked',
}: BookingListProps) {
  const id = useId();
  if (groups.every((group) => group.rows.length === 0)) return <>{emptyState}</>;
  return (
    <section
      className={styles.root}
      aria-label={label}
      data-placement={placement === 'card' ? placement : undefined}
      data-layout={layout === 'columns' ? layout : undefined}
    >
      {groups.map((group, groupIndex) => (
        <div key={group.id} className={styles.group}>
          {layout === 'columns' ? (
            <div className={styles.head}>
              <h3 className={styles.band}>
                {group.label}
                {group.sublabel !== undefined && <span className={styles.sublabel}> {group.sublabel}</span>}
              </h3>
              {group.count !== undefined && <span className={styles.count}>{group.count}</span>}
            </div>
          ) : (
            <h3 className={styles.band}>{group.label}</h3>
          )}
          <ul className={styles.rows} aria-label={group.label}>
            {group.rows.map((row, rowIndex) => {
              const rowId = `${id}-${String(groupIndex)}-${String(rowIndex)}`;
              const isOpen = row.id === openId;
              if (layout === 'columns') {
                return (
                  <Fragment key={row.id}>
                    {row.nowBefore !== undefined && (
                      <li className={styles.now} aria-hidden="true">
                        <span className={styles.nowLabel}>{row.nowBefore}</span>
                      </li>
                    )}
                    {/* As the stacked row: the title button is the keyboard's way in, a press anywhere else opens it. */}
                    {/* eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-noninteractive-element-interactions */}
                    <li
                      className={styles.row}
                      data-pressable=""
                      data-open={isOpen || undefined}
                      data-done={row.isDone === true || undefined}
                      data-new={row.isNew === true || undefined}
                      aria-current={isOpen || undefined}
                      onClick={(event) => {
                        const element = event.currentTarget;
                        openOnPress(event, () => onOpen(row.id, element));
                      }}
                    >
                      <span className={styles.when} id={`${rowId}-when`}>
                        <span className={styles.date}>{row.date}</span>
                        {row.time !== '' && <span className={styles.time}>{row.time}</span>}
                      </span>
                      <span className={styles.person}>
                        {row.chip !== undefined ? (
                          <span className={styles.face}>
                            <Avatar
                              name={row.chip.name}
                              id={row.chip.recordId}
                              size="lg"
                              isDecorative
                              {...(row.chip.imageSrc === undefined ? {} : { src: row.chip.imageSrc })}
                            />
                          </span>
                        ) : (
                          row.provider !== undefined && (
                            <span className={styles.face}>
                              <ProviderMark provider={row.provider} size="md" />
                            </span>
                          )
                        )}
                        <span className={styles.main}>
                          <span className={styles.titleLine}>
                            <span className={styles.name}>
                              <Button
                                variant="value"
                                aria-describedby={`${rowId}-when${row.subline === undefined ? '' : ` ${rowId}-sub`}`}
                                onPress={(event) => {
                                  const element =
                                    event.target instanceof HTMLElement ? event.target.closest('li') : null;
                                  if (element !== null) onOpen(row.id, element);
                                }}
                              >
                                {row.chip === undefined ? row.title : row.chip.name}
                              </Button>
                            </span>
                            {row.status !== undefined && (
                              <span className={styles.status}>
                                <StatusDot hue={row.status.hue}>{row.status.label}</StatusDot>
                              </span>
                            )}
                          </span>
                          {row.subline !== undefined && (
                            <span className={styles.subline} id={`${rowId}-sub`}>
                              {row.subline.icon !== undefined && <Icon name={row.subline.icon} size="xs" />}
                              <span className={styles.sublineText}>{row.subline.text}</span>
                            </span>
                          )}
                        </span>
                      </span>
                      <span className={styles.actions} data-quiet={row.actions === undefined || undefined}>
                        {row.join !== undefined && (
                          <span className={styles.joinAt}>
                            <ButtonLink
                              href={row.join.href}
                              isExternal
                              icon="video"
                              label={strings.join(row.join.provider)}
                            >
                              {strings.joinShort}
                            </ButtonLink>
                          </span>
                        )}
                        {row.quickActions !== undefined && <span className={styles.quick}>{row.quickActions}</span>}
                        {row.actions}
                      </span>
                    </li>
                  </Fragment>
                );
              }
              return (
                // The title button is the row's way in by keyboard; a press anywhere else on the row opens it too.
                // eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-noninteractive-element-interactions
                <li
                  key={row.id}
                  className={styles.row}
                  data-pressable=""
                  data-open={isOpen || undefined}
                  data-new={row.isNew === true || undefined}
                  aria-current={isOpen || undefined}
                  onClick={(event) => {
                    const element = event.currentTarget;
                    openOnPress(event, () => onOpen(row.id, element));
                  }}
                >
                  <div className={styles.when} id={`${rowId}-when`}>
                    <span className={styles.date}>{row.date}</span>
                    {row.time !== '' && <span className={styles.time}>{row.time}</span>}
                  </div>
                  <div className={styles.main}>
                    <div className={styles.titleLine}>
                      {/* Named by its title, then described by its time and who it is with (not the note or Join),
                        so each row's button says which meeting it opens. */}
                      <Button
                        variant="ghost"
                        aria-describedby={row.guestName === undefined ? `${rowId}-when` : `${rowId}-when ${rowId}-who`}
                        {...(openId === undefined ? {} : { isExpanded: row.id === openId })}
                        onPress={(event) => {
                          const element = event.target instanceof HTMLElement ? event.target.closest('li') : null;
                          if (element !== null) onOpen(row.id, element);
                        }}
                      >
                        {row.title}
                      </Button>
                      {row.badge !== undefined && <Badge text={row.badge} tone={row.badgeTone ?? 'neutral'} />}
                    </div>
                    {hasDetails(row) && (
                      // Everything else on one muted line: Join first so it never gets cut off, then who, then the rest.
                      <div className={styles.details}>
                        {row.join !== undefined && (
                          <span className={styles.join}>
                            <Icon name="video" size="sm" />
                            <Link href={row.join.href}>{strings.join(row.join.provider)}</Link>
                          </span>
                        )}
                        {row.guestName !== undefined && (
                          <span className={`${styles.text} ${styles.who}`} id={`${rowId}-who`}>
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
