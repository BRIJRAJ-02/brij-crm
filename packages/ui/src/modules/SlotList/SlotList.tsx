import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
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
}

/** Props for SlotList. */
export interface SlotListProps {
  /** The day the times are on: "Tue 20 Oct". */
  readonly heading: string;
  readonly slots: readonly Slot[];
  /** The picked time's id. */
  readonly value: string | undefined;
  readonly onChange: (id: string) => void;
  /** Moves on with the picked time: the button that sits beside it. */
  readonly onConfirm: () => void;
  readonly hour12: boolean;
  readonly onHour12Change: (hour12: boolean) => void;
  /** `column` (one time per row, scrolling in its pane: Month) or `grid` (two to four across: List, and phones). */
  readonly layout?: 'column' | 'grid';
  readonly isLoading?: boolean;
  /** Shown in the list's place when the day has no time to show (all hidden as busy, say). */
  readonly empty?: ReactNode;
  /** A key that changes with the day, the zone or the view, so the times stagger in again. */
  readonly drawKey?: string;
}

/**
 * The times of one day on a booking page (spec 0025, AC-666 to AC-669): the
 * day, the 12h or 24h switch, then the times. Picking a time never moves on;
 * the picked one splits in two, the time and Next, as calendars' booking
 * pages do, so the commit sits where the eye already is. A Best time carries
 * a tag; a time the visitor is busy for reads quieter, and can still be
 * picked.
 */
export function SlotList({
  heading,
  slots,
  value,
  onChange,
  onConfirm,
  hour12,
  onHour12Change,
  layout = 'column',
  isLoading = false,
  empty,
  drawKey,
}: SlotListProps) {
  const next = useRef<HTMLButtonElement>(null);
  // A picked time's Next slides in; on a phone it scrolls into view with it.
  useEffect(() => {
    if (value === undefined) return;
    const reduced = globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
    next.current?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }, [value]);
  return (
    <div className={styles.root} data-layout={layout}>
      <div className={styles.head}>
        <h2 className={styles.heading}>{heading}</h2>
        <SegmentedControl
          label={strings.clock}
          segments={[
            { value: '12', label: strings.hours12 },
            { value: '24', label: strings.hours24 },
          ]}
          value={hour12 ? '12' : '24'}
          onChange={(clock) => onHour12Change(clock === '12')}
        />
      </div>
      {isLoading ? (
        <div className={styles.loading} aria-busy="true">
          <VisuallyHidden>{strings.loading}</VisuallyHidden>
          <Skeleton shape="block" lines={5} />
        </div>
      ) : slots.length === 0 && empty !== undefined ? (
        <div className={styles.empty}>{empty}</div>
      ) : (
        <ul key={drawKey} className={styles.list} aria-label={strings.times(heading)}>
          {slots.map((slot, index) => {
            const isPicked = slot.id === value;
            return (
              <li
                key={slot.id}
                className={styles.item}
                data-picked={isPicked ? '' : undefined}
                style={{ '--slot-index': String(Math.min(index, 12)) }}
              >
                <button
                  type="button"
                  className={styles.slot}
                  data-busy={slot.isBusy === true ? '' : undefined}
                  aria-pressed={isPicked}
                  aria-label={[
                    slot.name,
                    slot.isBest === true ? strings.best : undefined,
                    slot.isBusy === true ? strings.busy : undefined,
                  ]
                    .filter((part) => part !== undefined)
                    .join(', ')}
                  onClick={() => onChange(slot.id)}
                >
                  <span className={styles.time}>{slot.label}</span>
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
                </button>
                {isPicked && (
                  <span className={styles.next}>
                    <Button ref={next} variant="primary" size="lg" isFullWidth onPress={onConfirm}>
                      {strings.next}
                    </Button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
