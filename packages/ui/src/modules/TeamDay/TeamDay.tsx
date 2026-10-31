import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
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
  /** Their day in a word or two: "3 booked", "Free", "Off", "Away". First on the line under the name, in its tone's colour. */
  readonly status: string;
  readonly tone: TeamDayTone;
  /** Their zone's offset, only when it differs from the reader's ("UTC+1"): after the status, short enough to keep. */
  readonly badge?: string;
  /** Their job title: on the line with `isTitleShown`, else in the head's tooltip. */
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
  /** Job titles on the heads' line, not only in their tooltips: while the columns are ordered by them (AC-1438). */
  readonly isTitleShown?: boolean;
  /**
   * Needs a host (AC-1435): one slim strip over the grid, only when it holds something. "N need a host" opens them
   * all as a list (a sheet on a phone); then one chip a booking (its time, title and guest), scrolling sideways, each
   * opening `detail` under it (its booking's card, with Reassign). Rows are BookingList's.
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
 * blocks, drawing, cards and keys), each column headed by the person, with time off as a band down it, and Needs a
 * host as one slim strip over the grid when there is something to hand on, so the columns keep the whole width.
 */
export function TeamDay({
  people,
  selectedPerson,
  onSelectPerson,
  focusPerson,
  isTitleShown = false,
  lane,
  ...calendar
}: TeamDayProps) {
  const days = useMemo(
    () =>
      people.map((person): WeekCalendarDay => {
        const title = person.title === undefined || person.title === '' ? undefined : person.title;
        // The line: the status, the offset when it differs, and the title only while the columns are ordered by it.
        const meta = [person.status, person.badge, isTitleShown ? title : undefined].filter(
          (part): part is string => part !== undefined && part !== '',
        );
        return {
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
              meta={meta}
              tone={person.tone === 'booked' ? 'quiet' : person.tone}
              size="sm"
              // What the line leaves out, after the name: the job title.
              {...(title === undefined || isTitleShown
                ? {}
                : { hint: `${person.name}${strings.hintSeparator}${title}` })}
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
        };
      }),
    [people, isTitleShown],
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

/** Whether the strip sits in a container narrower than `bp-container-md` (a phone): its list and cards are sheets. */
function isNarrow(element: HTMLElement): boolean {
  const root = element.closest('[data-team-day]');
  if (!(root instanceof HTMLElement)) return false;
  const narrow = Number.parseFloat(getComputedStyle(root).getPropertyValue('--bp-container-md'));
  return Number.isFinite(narrow) && root.clientWidth < narrow;
}

/** A chip's words, which are its name too: the time, the title, the guest, and Host away when it is that. */
function chipLabel(row: BookingListRow): string {
  return [row.date, row.title, row.guestName, row.badge]
    .filter((part) => part !== undefined && part !== '')
    .join(strings.hintSeparator);
}

/**
 * The strip: "N need a host", which lists them all, then a chip a booking, one row that scrolls sideways; a chip opens
 * its booking's card under it. Narrow, the chips give way to the one button, and its list and cards are sheets; a card
 * opened from the list goes back to the list when it closes, so the next one is a press away.
 */
function Strip({ lane }: { readonly lane: NonNullable<TeamDayProps['lane']> }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [isSheet, setSheet] = useState(false);
  const [list, setList] = useState<'closed' | 'popover' | 'sheet'>('closed');
  const [isFromList, setFromList] = useState(false);
  const summary = useRef<HTMLButtonElement>(null);
  const chips = useRef(new Map<string, HTMLButtonElement>());
  const anchorRef = useMemo(() => ({ current: anchor }), [anchor]);
  const count = lane.rows.length;
  const isOpen = lane.openId !== undefined && lane.rows.some((row) => row.id === lane.openId) && anchor !== null;
  /** A booking's card, under the element it opened from (a sheet when narrow). */
  const open = (id: string, from: HTMLElement) => {
    setAnchor(from);
    setSheet(isNarrow(from));
    lane.onOpen(id);
  };
  /** Closed by Escape, a press outside or the sheet's close: back to the list it came from, else to its chip. */
  const close = () => {
    const from = anchor;
    lane.onClose();
    if (isFromList && summary.current !== null) {
      setFromList(false);
      setList(isNarrow(summary.current) ? 'sheet' : 'popover');
      return;
    }
    focusLater(() => from);
  };
  const closeList = () => {
    setList('closed');
    focusLater(() => summary.current);
  };
  const listed = (
    <BookingList
      // Its own name: the strip's region keeps "Needs a host, N bookings", and two landmarks never share one.
      label={strings.laneTitle}
      placement="card"
      groups={[{ id: 'lane', label: strings.laneTitle, rows: lane.rows }]}
      onOpen={(id) => {
        setList('closed');
        setFromList(true);
        // Under its chip when the chips show, else under the button that listed it.
        const chip = chips.current.get(id);
        const from = chip !== undefined && chip.offsetParent !== null ? chip : summary.current;
        if (from !== null) open(id, from);
      }}
    />
  );
  return (
    <section className={styles.strip} aria-label={strings.laneLabel(count)}>
      <Button
        ref={summary}
        variant="warning"
        icon="user-x"
        isExpanded={list !== 'closed'}
        onPress={() => {
          if (list !== 'closed') {
            closeList();
            return;
          }
          if (summary.current !== null) setList(isNarrow(summary.current) ? 'sheet' : 'popover');
        }}
      >
        {strings.laneSummary(count)}
      </Button>
      <ul className={styles.chips}>
        {lane.rows.map((row) => (
          <li key={row.id} className={styles.item}>
            <Button
              ref={(element) => {
                if (element === null) chips.current.delete(row.id);
                else chips.current.set(row.id, element);
              }}
              isExpanded={row.id === lane.openId}
              onPress={(event) => {
                if (row.id === lane.openId) {
                  lane.onClose();
                  return;
                }
                setFromList(false);
                if (event.target instanceof HTMLElement) open(row.id, event.target);
              }}
            >
              {chipLabel(row)}
            </Button>
          </li>
        ))}
      </ul>
      {list === 'sheet' && (
        <Modal
          variant="sheet"
          title={strings.laneTitle}
          isOpen
          isDismissable
          onOpenChange={(next) => {
            if (!next) closeList();
          }}
        >
          {listed}
        </Modal>
      )}
      {list === 'popover' && (
        <Popover
          triggerRef={summary}
          isOpen
          onOpenChange={(next) => {
            if (!next) closeList();
          }}
          placement="bottom start"
          label={strings.laneTitle}
        >
          <div className={styles.list}>{listed}</div>
        </Popover>
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
