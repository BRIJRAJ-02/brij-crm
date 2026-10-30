import { useMemo, useState, type ReactNode } from 'react';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import { TruncatedText } from '../../atoms/TruncatedText/TruncatedText.tsx';
import { Popover } from '../../molecules/Popover/Popover.tsx';
import { WeekCalendar, type WeekCalendarDay, type WeekCalendarProps } from '../WeekCalendar/WeekCalendar.tsx';
import { strings } from './strings.ts';
import styles from './TeamDay.module.css';

/**
 * How a person's day stands, as their head's status reads: `booked` (meetings that day), `free` (none, but hours),
 * `off` (no hours that day) or `away` (time off).
 */
export type TeamDayTone = 'booked' | 'free' | 'off' | 'away';

/** One person's column. */
export interface TeamDayPerson {
  readonly id: string;
  readonly name: string;
  /** Their job title, quiet under the name. */
  readonly title?: string;
  /** Their day in a few words: "3 booked", "Free", "No hours", "Away". */
  readonly status: string;
  readonly tone: TeamDayTone;
  /** Their zone's offset after the status, only when it differs from the reader's ("UTC+5:30"). */
  readonly badge?: string;
  /** More at the head's end: their calendar's health chip, when it needs saying. */
  readonly extra?: ReactNode;
  /** The column's whole name for screen readers: "Sam Lee, Sales lead, 3 booked". */
  readonly label: string;
  /** Time off over the day, as a band down the column: its word, and its minutes on the reader's clock. */
  readonly band?: WeekCalendarDay['band'];
  /**
   * False when the reader may only See this person (spec 0037): empty time on their column draws nothing, and shows
   * no crosshair. Absent, it draws as the grid does.
   */
  readonly canAct?: boolean;
}

/** One booking in the Needs a host lane. */
export interface TeamDayLaneItem {
  readonly id: string;
  /** Its time on the reader's clock ("10:00 AM"). */
  readonly time: string;
  /** Its page's title. */
  readonly title: string;
  /** Who it is with, and whose it was ("Visitor · Sam Lee"). */
  readonly detail: string;
  /** Why it is here: "Needs a host" or "Host away". */
  readonly status: string;
  /** What a screen reader hears for the whole item. */
  readonly label: string;
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
  /** Today: drawn as the week draws its today (the now line runs across every column). */
  readonly focusPerson?: WeekCalendarProps['focusDay'];
  /**
   * The Needs a host lane, pinned at the start (AC-1435): only when it holds something. Pressing an item opens
   * `laneDetail` beside it (its booking's card, with Reassign).
   */
  readonly lane?: {
    readonly items: readonly TeamDayLaneItem[];
    readonly openId?: string;
    readonly detail?: ReactNode;
    readonly onOpen: (id: string) => void;
    readonly onClose: () => void;
  };
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
        label: person.label,
        isToday: false,
        isPast: false,
        head: <PersonHead person={person} />,
        ...(person.band === undefined ? {} : { band: person.band }),
        ...(person.canAct === false ? { canDraw: false } : {}),
      })),
    [people],
  );
  const items = lane?.items ?? [];
  return (
    <div className={styles.root} data-lane={items.length > 0 || undefined}>
      {lane !== undefined && items.length > 0 && <Lane lane={{ ...lane, items }} />}
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

/** A person's head: their picture, name and title, and how their day stands, with their calendar's chip after. */
function PersonHead({ person }: { readonly person: TeamDayPerson }) {
  return (
    <span className={styles.person} aria-hidden="true">
      <span className={styles.picture}>
        <Avatar name={person.name} id={person.id} size="sm" isDecorative />
      </span>
      <span className={styles.who}>
        <span className={styles.name}>
          <TruncatedText>{person.name}</TruncatedText>
        </span>
        {person.title !== undefined && (
          <span className={styles.title}>
            <TruncatedText>{person.title}</TruncatedText>
          </span>
        )}
        <span className={styles.status} data-tone={person.tone}>
          {person.status}
          {person.badge !== undefined && `${strings.separator}${person.badge}`}
        </span>
      </span>
      {person.extra !== undefined && <span className={styles.extra}>{person.extra}</span>}
    </span>
  );
}

/** The lane: its count, then each booking as a card that opens its booking's card beside it. */
function Lane({ lane }: { readonly lane: NonNullable<TeamDayProps['lane']> }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const anchorRef = useMemo(() => ({ current: anchor }), [anchor]);
  const isOpen = lane.openId !== undefined && lane.items.some((item) => item.id === lane.openId) && anchor !== null;
  return (
    <section className={styles.lane} aria-label={strings.laneLabel(lane.items.length)}>
      <header className={styles.laneHead}>
        <h2 className={styles.laneTitle}>{strings.lane}</h2>
        <Badge count={lane.items.length} tone="accent" />
      </header>
      <p className={styles.laneHint}>{strings.laneHint}</p>
      <ul className={styles.laneList}>
        {lane.items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={styles.laneItem}
              data-open={item.id === lane.openId || undefined}
              aria-haspopup="dialog"
              aria-expanded={item.id === lane.openId}
              aria-label={item.label}
              onClick={(event) => {
                if (item.id === lane.openId) {
                  lane.onClose();
                  return;
                }
                setAnchor(event.currentTarget);
                lane.onOpen(item.id);
              }}
            >
              <span className={styles.laneTime}>{item.time}</span>
              <span className={styles.laneItemTitle}>
                <TruncatedText>{item.title}</TruncatedText>
              </span>
              <span className={styles.laneDetail}>
                <TruncatedText>{item.detail}</TruncatedText>
              </span>
              <span className={styles.laneStatus}>{item.status}</span>
            </button>
          </li>
        ))}
      </ul>
      {isOpen && lane.detail !== undefined && (
        <Popover
          triggerRef={anchorRef}
          isOpen
          onOpenChange={(open) => {
            if (!open) lane.onClose();
          }}
          placement="end top"
          label={strings.details}
        >
          {lane.detail}
        </Popover>
      )}
    </section>
  );
}
