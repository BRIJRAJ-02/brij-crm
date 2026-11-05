import { useId, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { SegmentedControl } from '../../molecules/SegmentedControl/SegmentedControl.tsx';
import styles from './SlotList.module.css';
import { strings } from './strings.ts';

/** One bookable time. */
export interface Slot {
  /** Its start, as the page keys it (an ISO instant). */
  readonly id: string;
  /** "9:30 AM" or "09:30". */
  readonly label: string;
  /** What a screen reader says: "9:30 AM, Tue 20 Oct, 30 minutes". */
  readonly name: string;
  /** A best time for both: shared, at a good hour, with room around it. */
  readonly isBest?: boolean;
  /** The visitor's own calendar is busy then (shown only when they ask to see every time). */
  readonly isBusy?: boolean;
  /**
   * A quieter second line under the time: the same time on another clock (a host's Reschedule shows the guest's,
   * "03:30 London"). Read out through `name`, so the screen puts it there too.
   */
  readonly detail?: string;
}

/** One group of times under its own small heading: a restaurant's Lunch or Dinner (spec 0066 B7). */
export interface SlotGroup {
  readonly id: string;
  /** "Lunch". */
  readonly heading: string;
  readonly slots: readonly Slot[];
}

/** Props for SlotList. */
export interface SlotListProps {
  /** The day the times are on: "Tue 20 Oct". */
  readonly heading: string;
  readonly slots: readonly Slot[];
  /** The picked time's id. */
  readonly value: string | undefined;
  readonly onChange: (id: string) => void;
  /**
   * Enter on a time picks it and then moves on (critic C7, QA B-14): the page puts focus on Book, so a keyboard
   * never tabs through the rest of the day's times to reach it. A pointer's pick stays put.
   */
  readonly onCommit?: (id: string) => void;
  readonly hour12?: boolean;
  /** Shows the 12h or 24h switch beside the heading; left out, there is none (the chat's offers). */
  readonly onHour12Change?: (hour12: boolean) => void;
  /**
   * `picker` (the default): a picked time fills and stays picked. `offers`: a time is an action (the booking chat,
   * spec 0042), with no picked state, under a small day heading.
   */
  readonly variant?: 'picker' | 'offers';
  /** `column` (one time per row, scrolling in its pane: Month) or `grid` (two to four across: List, and phones). */
  readonly layout?: 'column' | 'grid';
  /** A variant's classes, from its own stylesheet: `SlotListGroups` passes its groups here. */
  readonly look?: Readonly<Record<string, string | undefined>>;
  readonly isLoading?: boolean;
  /** How many time boxes stand in while loading: 16 (a nine to five day) unless the caller knows better (the chat's six). */
  readonly ghosts?: number;
  /** Shown in the list's place when the day has no time to show (all hidden as busy, say). */
  readonly empty?: ReactNode;
  /** A key that changes with the day, the zone or the view, so the times stagger in again. */
  readonly drawKey?: string;
  /**
   * Offers only: the time already picked from these, kept as the record of the answer (the booking chat). It keeps a
   * fill and a check, the rest go quiet, and none can be pressed again. Nothing is removed, so nothing below moves.
   */
  readonly answered?: string;
  /**
   * The times in groups, each under its small heading (a restaurant's Lunch and Dinner, spec 0066 B7), in one list
   * that scrolls as one and runs three across at any width. Given, it takes the place of `slots` and `layout`.
   */
  readonly groups?: readonly SlotGroup[];
  /** Beside the heading: the page's own short count (a neutral Badge, "12 available"). */
  readonly badge?: ReactNode;
  /** The first time's button, so the page can move focus to the times (a time taken meanwhile, or Pick a time). */
  readonly firstRef?: Ref<HTMLButtonElement>;
}

/**
 * How many time boxes the loading list holds: a nine to five day at half hour
 * steps, which is what a page offers until its owner says otherwise. The list
 * is better a little too tall than a little too short: inside a site's frame
 * the page is only as tall as the height it last reported, so a list that
 * grows when the times land leaves the frame scrolling until the new height
 * reaches the host, while one that shrinks never does.
 */
const GHOST_SLOTS = 16;

/** How many columns a list's grid lays out now, read off its own style, so Up and Down move a row. */
function columnsOf(list: HTMLElement | null): number {
  if (list === null) return 1;
  const tracks = globalThis
    .getComputedStyle(list)
    .gridTemplateColumns.split(' ')
    .filter((track) => track !== '');
  return Math.max(1, tracks.length);
}

/**
 * The times of one day on a booking page (spec 0025, AC-666 to AC-669): the
 * day, the 12h or 24h switch, then the times. Picking a time never moves on;
 * the picked one fills, and the page's Book bar names it. A Best time carries
 * a tag; a time the visitor is busy for reads quieter, and can still be
 * picked. One time is in the tab order (the picked one, else the first) and
 * the arrows move among them, as the days do (critic C7).
 */
export function SlotList({
  heading,
  slots,
  value,
  onChange,
  onCommit,
  hour12 = true,
  onHour12Change,
  variant = 'picker',
  layout = 'column',
  look,
  isLoading = false,
  ghosts = GHOST_SLOTS,
  empty,
  drawKey,
  answered,
  groups,
  badge,
  firstRef,
}: SlotListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const isLocked = variant === 'offers' && answered !== undefined;
  const shownGroups = groups?.filter((group) => group.slots.length > 0);
  // Every time in the order they read, across the groups, for the tab stop and the arrows.
  const all = shownGroups === undefined ? slots : shownGroups.flatMap((group) => group.slots);
  const isEmpty = all.length === 0;
  // The tab stop: the picked time, else the one the keyboard last stood on, else the first (review, 5 Nov 2026: tabbing
  // away and back returned to the first time).
  const [lastFocused, setLastFocused] = useState<string | undefined>(undefined);
  const has = (id: string | undefined) => id !== undefined && all.some((slot) => slot.id === id);
  const tabbable = has(value) ? value : has(lastFocused) ? lastFocused : all[0]?.id;
  const slotButton = (id: string) =>
    [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-slot]') ?? [])].find(
      (button) => button.dataset.slot === id,
    );
  const onKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = all.findIndex((slot) => slot.id === event.currentTarget.dataset.slot);
    if (index < 0) return;
    if (event.key === 'Enter' && !isLocked) {
      event.preventDefault();
      const id = all[index]?.id;
      if (id === undefined) return;
      onChange(id);
      onCommit?.(id);
      return;
    }
    const across = columnsOf(listRef.current?.querySelector('ul') ?? null);
    const moves: Readonly<Record<string, number>> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      ArrowDown: index + across,
      ArrowUp: index - across,
      Home: 0,
      End: all.length - 1,
    };
    const to = moves[event.key];
    if (to === undefined) return;
    event.preventDefault();
    const next = all[Math.min(Math.max(to, 0), all.length - 1)];
    if (next !== undefined) slotButton(next.id)?.focus();
  };
  const groupId = useId();
  /** One time's button in its row; `index` runs across the groups, so the stagger carries on from one to the next. */
  const item = (slot: Slot, index: number) => {
    const isPicked = variant === 'picker' && slot.id === value;
    const isAnswer = variant === 'offers' && answered !== undefined && slot.id === answered;
    return (
      <li
        key={slot.id}
        className={styles.item}
        data-picked={isPicked ? '' : undefined}
        data-answer={isAnswer ? '' : undefined}
        data-quiet={variant === 'offers' && answered !== undefined && !isAnswer ? '' : undefined}
        style={{ '--slot-index': String(Math.min(index, 12)) }}
      >
        <button
          {...(index === 0 && firstRef !== undefined ? { ref: firstRef } : {})}
          type="button"
          className={styles.slot}
          data-slot={slot.id}
          tabIndex={slot.id === tabbable ? 0 : -1}
          onKeyDown={onKey}
          onFocus={() => setLastFocused(slot.id)}
          data-busy={slot.isBusy === true ? '' : undefined}
          {...(variant === 'picker' ? { 'aria-pressed': isPicked } : {})}
          {...(variant === 'offers' && answered !== undefined
            ? { 'aria-disabled': true, ...(isAnswer ? { 'aria-current': true } : {}) }
            : {})}
          aria-label={[
            slot.name,
            slot.isBest === true ? strings.best : undefined,
            slot.isBusy === true ? strings.busy : undefined,
            isAnswer ? strings.picked : undefined,
          ]
            .filter((part) => part !== undefined)
            .join(', ')}
          onClick={() => {
            if (variant === 'offers' && answered !== undefined) return;
            onChange(slot.id);
          }}
        >
          {isAnswer && <Icon name="check" size="sm" />}
          {/* Keyed by its words, so 12h to 24h fades the new label in where the old one was. */}
          <span key={slot.label} className={styles.time}>
            {slot.label}
          </span>
          {slot.isBest === true && (
            <span className={styles.best} aria-hidden="true">
              {strings.bestTag}
            </span>
          )}
          {slot.isBusy === true && (
            <span className={styles.busy} aria-hidden="true">
              {strings.busyTag}
            </span>
          )}
          {slot.detail !== undefined && (
            <span className={styles.detail} aria-hidden="true">
              {slot.detail}
            </span>
          )}
        </button>
      </li>
    );
  };
  return (
    <div
      ref={listRef}
      className={look?.root === undefined ? styles.root : `${styles.root ?? ''} ${look.root}`}
      data-layout={groups === undefined ? layout : 'groups'}
      data-variant={variant}
      data-answered={variant === 'offers' && answered !== undefined ? '' : undefined}
    >
      {variant === 'offers' ? (
        <p className={styles.day} aria-hidden="true">
          {/* The day's label line while loading, so the times below sit where they will. */}
          {isLoading && heading === '' ? <Skeleton shape="text" width="short" /> : heading}
        </p>
      ) : (
        <div className={styles.head}>
          {/* Only once there is a day: a heading with nothing in it is an empty heading, and `.head` holds the
              row's height either way. The heading stays mounted as the day changes and only its words swap
              (critic C8), so the row never blanks. */}
          {heading !== '' && (
            <h2 className={styles.heading}>
              <span key={heading} className={styles.headingWords}>
                {heading}
              </span>
            </h2>
          )}
          {badge !== undefined && !isLoading && <span className={styles.badge}>{badge}</span>}
          {onHour12Change !== undefined && (
            <SegmentedControl
              label={strings.clock}
              segments={[
                { value: '12', label: strings.hours12 },
                { value: '24', label: strings.hours24 },
              ]}
              value={hour12 ? '12' : '24'}
              onChange={(clock) => onHour12Change(clock === '12')}
            />
          )}
        </div>
      )}
      {isLoading ? (
        /* The times' own grid, with a time's box in each place, so the list is
           already the right height and shape before a single time arrives. */
        <>
          <VisuallyHidden>{strings.loading}</VisuallyHidden>
          <ul className={styles.list} aria-busy="true">
            {Array.from({ length: ghosts }, (_, index) => (
              <li key={index} className={styles.item} data-loading="" aria-hidden="true">
                <Skeleton shape="fill" />
              </li>
            ))}
          </ul>
        </>
      ) : isEmpty && empty !== undefined ? (
        <div className={styles.empty}>{empty}</div>
      ) : shownGroups !== undefined ? (
        // One list that scrolls as one: each group under its small heading, the stagger running on across them.
        <div key={drawKey} className={look?.scroller}>
          {shownGroups.map((group, groupIndex) => {
            const before = shownGroups.slice(0, groupIndex).reduce((count, each) => count + each.slots.length, 0);
            const headingId = `${groupId}-${String(groupIndex)}`;
            return (
              // A plain block under its small heading: Lunch and Dinner are never landmarks of their own.
              <div key={group.id} className={look?.group}>
                <h3 id={headingId} className={look?.groupHeading}>
                  {group.heading}
                </h3>
                <ul
                  className={look?.list === undefined ? styles.list : `${styles.list ?? ''} ${look.list}`}
                  aria-label={strings.groupTimes(group.heading, heading)}
                >
                  {group.slots.map((slot, index) => item(slot, before + index))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : (
        <ul key={drawKey} className={styles.list} aria-label={strings.times(heading)}>
          {slots.map((slot, index) => item(slot, index))}
        </ul>
      )}
    </div>
  );
}
