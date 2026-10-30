import { useMemo, useState, type ReactNode } from 'react';
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
  /** Their day in a word or two: "3 booked", "Free", "Off", "Away". First on the line under the name. */
  readonly status: string;
  readonly tone: TeamDayTone;
  /** Their zone's offset, only when it differs from the reader's ("UTC+1"): after the status. */
  readonly badge?: string;
  /** Their job title, last on the line, so it is what gets cut when the column is narrow. */
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
   * The Needs a host lane, pinned at the start (AC-1435): only when it holds something. Its rows are BookingList's;
   * pressing one opens `detail` beside it (its booking's card, with Reassign), or as a sheet on a phone.
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

/**
 * The Team day (spec 0030): one day, one column per person across, the hours down, on WeekCalendar's `team` view (its
 * blocks, drawing, cards and keys), each column headed by the person, with time off as a band down it, and the Needs a
 * host lane pinned at the start when there is something to hand on.
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
            meta={[
              person.status,
              ...(person.badge === undefined ? [] : [person.badge]),
              ...(person.title === undefined ? [] : [person.title]),
            ]}
            tone={person.tone === 'away' ? 'away' : 'quiet'}
            size="sm"
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
      {lane !== undefined && rows.length > 0 && <Lane lane={{ ...lane, rows }} />}
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

/** Whether the lane sits in a container narrower than `bp-container-md` (a phone): its card opens as a sheet. */
function isNarrow(element: HTMLElement): boolean {
  const root = element.closest('[data-team-day]');
  if (!(root instanceof HTMLElement)) return false;
  const narrow = Number.parseFloat(getComputedStyle(root).getPropertyValue('--bp-container-md'));
  return Number.isFinite(narrow) && root.clientWidth < narrow;
}

/** The lane: its bookings as BookingList's rows, each opening its booking's card beside it (a sheet on a phone). */
function Lane({ lane }: { readonly lane: NonNullable<TeamDayProps['lane']> }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [isSheet, setSheet] = useState(false);
  const anchorRef = useMemo(() => ({ current: anchor }), [anchor]);
  const isOpen = lane.openId !== undefined && lane.rows.some((row) => row.id === lane.openId) && anchor !== null;
  /** Closed by Escape, a press outside or the sheet's close: focus goes back to the row's button. */
  const close = () => {
    const from = anchor;
    lane.onClose();
    focusLater(() => from?.querySelector('button') ?? undefined);
  };
  return (
    <section className={styles.lane} aria-label={strings.laneLabel(lane.rows.length)}>
      <BookingList
        label={strings.laneLabel(lane.rows.length)}
        placement="card"
        groups={[{ id: 'lane', label: strings.laneTitle(lane.rows.length), rows: lane.rows }]}
        {...(lane.openId === undefined ? {} : { openId: lane.openId })}
        onOpen={(id, row) => {
          if (id === lane.openId) {
            lane.onClose();
            return;
          }
          setAnchor(row);
          setSheet(isNarrow(row));
          lane.onOpen(id);
        }}
      />
      {isOpen &&
        lane.detail !== undefined &&
        (isSheet ? (
          <Modal
            variant="sheet"
            title={strings.details}
            isOpen
            isDismissable
            onOpenChange={(open) => {
              if (!open) close();
            }}
          >
            {lane.detail}
          </Modal>
        ) : (
          <Popover
            triggerRef={anchorRef}
            isOpen
            onOpenChange={(open) => {
              if (!open) close();
            }}
            placement="end top"
            label={strings.details}
          >
            {lane.detail}
          </Popover>
        ))}
    </section>
  );
}
