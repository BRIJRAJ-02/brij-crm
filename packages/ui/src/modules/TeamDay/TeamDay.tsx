import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { focusLater } from '../../lib/focus-later.ts';
import { Modal } from '../../molecules/Modal/Modal.tsx';
import { PersonLine } from '../../molecules/PersonLine/PersonLine.tsx';
import { Popover } from '../../molecules/Popover/Popover.tsx';
import { BookingList, type BookingListRow } from '../BookingList/BookingList.tsx';
import { WeekCalendar, type WeekCalendarDay, type WeekCalendarProps } from '../WeekCalendar/WeekCalendar.tsx';
import { strings } from './strings.ts';
import styles from './TeamDay.module.css';

/** How a person's day stands, as their head's status reads: booked, free, off (no hours that day) or away. */
export type TeamDayTone = 'booked' | 'free' | 'off' | 'away';

/** One person's column. */
export interface TeamDayPerson {
  readonly id: string;
  readonly name: string;
  /** Their day in a word or two: "3 booked", "Free", "Off", "Away". The one line under the name, in its tone's colour. */
  readonly status: string;
  readonly tone: TeamDayTone;
  /** Their zone's offset, only when it differs from the reader's ("UTC+1"): in the head's tooltip. */
  readonly badge?: string;
  /** Their job title: first in the head's tooltip. */
  readonly title?: string;
  /** At the head's end: their calendar's trouble chip, when there is any. */
  readonly extra?: ReactNode;
  /** What `extra` says, for the column's name ("Reconnect needed"). */
  readonly extraLabel?: string;
  /** Time off over the day, as a band down the column: its word, and its minutes on the reader's clock. */
  readonly band?: WeekCalendarDay['band'];
  /**
   * False when the reader may only See this person (spec 0037): empty time on their column draws nothing and shows no
   * crosshair, the head carries an eye, and the column's name says "view only". Absent, it draws as the grid does.
   */
  readonly canAct?: boolean;
}

/** Props for TeamDay. */
export interface TeamDayProps extends Omit<
  WeekCalendarProps,
  'days' | 'view' | 'selectedDay' | 'onSelectDay' | 'focusDay'
> {
  /** One column each, in order. */
  readonly people: readonly TeamDayPerson[];
  /** The column the arrow keys start from and a phone shows. */
  readonly selectedPerson: string;
  readonly onSelectPerson: (id: string) => void;
  /** A block or column to focus (WeekCalendar's `focusDay`), the person's id as the day. */
  readonly focusPerson?: WeekCalendarProps['focusDay'];
  /**
   * Needs a host (AC-1435): one slim strip over the grid, only when it holds something, one chip a booking (its time,
   * title and guest) scrolling sideways; pressing one opens `detail` under it (its booking's card, with Reassign). In a
   * narrow window the strip is one "2 need a host" chip that lists them in a sheet. Rows are BookingList's.
   */
  readonly lane?: {
    readonly rows: readonly BookingListRow[];
    readonly openId?: string;
    readonly detail?: ReactNode;
    readonly onOpen: (id: string) => void;
    readonly onClose: () => void;
  };
}

/** A column's whole name for screen readers, from what its head shows (the head itself is hidden from them). */
function columnName(person: TeamDayPerson): string {
  return [
    person.name,
    person.status,
    person.badge,
    person.title,
    person.extraLabel,
    person.canAct === false ? strings.viewOnly : undefined,
  ]
    .filter((part) => part !== undefined && part !== '')
    .join(', ');
}

/** The head's tooltip: what the one line leaves out (title, offset, trouble), after the name. */
function headHint(person: TeamDayPerson): string {
  return [person.name, person.title, person.status, person.badge, person.extraLabel]
    .filter((part) => part !== undefined && part !== '')
    .join(strings.hintSeparator);
}

/**
 * The Team day (spec 0030): one day, one column per person across, the hours down, on WeekCalendar's `team` view (its
 * blocks, drawing, cards and keys), each column headed by the person, with time off as a band down it, and Needs a
 * host as one slim strip over the grid when there is something to hand on, so the columns keep the whole width.
 */
export function TeamDay({ people, selectedPerson, onSelectPerson, focusPerson, lane, ...calendar }: TeamDayProps) {
  const days = useMemo(
    () =>
      people.map((person): WeekCalendarDay => ({
        key: person.id,
        weekday: '',
        dayNumber: '',
        label: columnName(person),
        isToday: false,
        isPast: false,
        head: (
          <PersonLine
            id={person.id}
            name={person.name}
            meta={person.status === '' ? [] : [person.status]}
            tone={person.tone}
            size="sm"
            hint={headHint(person)}
            isDecorative
            {...(person.canAct === false || person.extra !== undefined
              ? {
                  end: (
                    <>
                      {person.canAct === false && <Icon name="eye" size="sm" />}
                      {person.extra}
                    </>
                  ),
                }
              : {})}
          />
        ),
        ...(person.band === undefined ? {} : { band: person.band }),
        ...(person.canAct === false ? { canDraw: false } : {}),
      })),
    [people],
  );
  const rows = lane?.rows ?? [];
  return (
    <div className={styles.root} data-team-day="">
      {lane !== undefined && rows.length > 0 && <Strip lane={{ ...lane, rows }} />}
      <div className={styles.grid}>
        <WeekCalendar
          {...calendar}
          view="team"
          days={days}
          selectedDay={selectedPerson}
          onSelectDay={onSelectPerson}
          {...(focusPerson === undefined ? {} : { focusDay: focusPerson })}
        />
      </div>
    </div>
  );
}

/** Whether the strip sits in a container narrower than `bp-container-md` (a phone): a card opens as a sheet there. */
function isNarrow(element: HTMLElement): boolean {
  const root = element.closest('[data-team-day]');
  if (!(root instanceof HTMLElement)) return false;
  const narrow = Number.parseFloat(getComputedStyle(root).getPropertyValue('--bp-container-md'));
  return Number.isFinite(narrow) && root.clientWidth < narrow;
}

/** A chip's name: the booking's title, its time and its guest, as the chip shows them. */
function chipName(row: BookingListRow): string {
  return [row.title, row.date, row.guestName, row.badge].filter((part) => part !== undefined && part !== '').join(', ');
}

/**
 * The strip: "Needs a host · 2", then a chip a booking, one row that scrolls sideways; a chip opens its booking's
 * card under it. Narrow, one chip says how many and lists them in a sheet, and a booking picked there opens as one.
 */
function Strip({ lane }: { readonly lane: NonNullable<TeamDayProps['lane']> }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [isSheet, setSheet] = useState(false);
  const [isListOpen, setListOpen] = useState(false);
  const summary = useRef<HTMLButtonElement>(null);
  const anchorRef = useMemo(() => ({ current: anchor }), [anchor]);
  const count = lane.rows.length;
  const isOpen = lane.openId !== undefined && lane.rows.some((row) => row.id === lane.openId) && anchor !== null;
  /** Closed by Escape, a press outside or the sheet's close: focus goes back to what opened it. */
  const close = () => {
    const from = anchor;
    lane.onClose();
    focusLater(() => from);
  };
  const open = (id: string, from: HTMLElement) => {
    setAnchor(from);
    setSheet(isNarrow(from));
    lane.onOpen(id);
  };
  return (
    <section className={styles.strip} aria-label={strings.laneLabel(count)}>
      <span className={styles.lead} aria-hidden="true">
        <Icon name="user-x" size="sm" />
        <span className={styles.count}>{strings.laneCount(count)}</span>
      </span>
      <ul className={styles.chips}>
        {lane.rows.map((row) => (
          <li key={row.id} className={styles.item}>
            <button
              type="button"
              className={styles.chip}
              aria-label={chipName(row)}
              aria-haspopup="dialog"
              aria-expanded={row.id === lane.openId}
              data-open={row.id === lane.openId || undefined}
              onClick={(event) => {
                if (row.id === lane.openId) {
                  lane.onClose();
                  return;
                }
                open(row.id, event.currentTarget);
              }}
            >
              <span className={styles.time}>{row.date}</span>
              <span className={styles.title}>{row.title}</span>
              {row.guestName !== undefined && <span className={styles.who}>{row.guestName}</span>}
            </button>
          </li>
        ))}
      </ul>
      {/* A narrow window: one chip for them all, opening their list. */}
      <button
        ref={summary}
        type="button"
        className={styles.summary}
        aria-haspopup="dialog"
        aria-expanded={isListOpen}
        onClick={() => setListOpen(true)}
      >
        <Icon name="user-x" size="sm" />
        {strings.laneSummary(count)}
      </button>
      {isListOpen && (
        <Modal
          variant="sheet"
          title={strings.laneTitle}
          isOpen
          isDismissable
          onOpenChange={(next) => {
            if (next) return;
            setListOpen(false);
            focusLater(() => summary.current);
          }}
        >
          <BookingList
            // Its own name: the strip's region keeps "Needs a host, N bookings", and two landmarks never share one.
            label={strings.laneTitle}
            placement="card"
            groups={[{ id: 'lane', label: strings.laneTitle, rows: lane.rows }]}
            onOpen={(id) => {
              setListOpen(false);
              if (summary.current !== null) open(id, summary.current);
            }}
          />
        </Modal>
      )}
      {isOpen &&
        lane.detail !== undefined &&
        (isSheet ? (
          <Modal
            variant="sheet"
            title={strings.details}
            isOpen
            isDismissable
            onOpenChange={(next) => {
              if (!next) close();
            }}
          >
            {lane.detail}
          </Modal>
        ) : (
          <Popover
            triggerRef={anchorRef}
            isOpen
            onOpenChange={(next) => {
              if (!next) close();
            }}
            placement="bottom start"
            label={strings.details}
          >
            {lane.detail}
          </Popover>
        ))}
    </section>
  );
}
