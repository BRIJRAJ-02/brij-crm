import { ToggleButton as AriaToggleButton, ToggleButtonGroup, type Key } from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import type { LoadStatus } from '../../lib/load-status.ts';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import styles from './SlotPicker.module.css';
import { strings } from './strings.ts';

/** One day of the week shown. */
export interface SlotDay {
  readonly id: string;
  /** The weekday, short ("Mon"). */
  readonly weekday: string;
  /** The day of the month ("2"). */
  readonly day: string;
  /** The whole date, read to screen readers ("Monday 2 November"). */
  readonly label: string;
  /** False when the day has no open time: it can't be chosen. */
  readonly hasSlots: boolean;
}

/** One bookable time on the chosen day. */
export interface SlotTime {
  readonly id: string;
  /** The time in the visitor's zone ("09:30"). */
  readonly label: string;
}

/** Props for SlotPicker. */
export interface SlotPickerProps {
  /** The week shown ("2 to 8 November 2026"). */
  readonly weekLabel: string;
  readonly days: readonly SlotDay[];
  readonly selectedDayId?: string;
  readonly onSelectDay: (id: string) => void;
  /** The chosen day's times. */
  readonly slots: readonly SlotTime[];
  /** Picks a time: the page moves on to the visitor's details. */
  readonly onPickSlot: (id: string) => void;
  readonly onPreviousWeek: () => void;
  readonly onNextWeek: () => void;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  /** The week's times are loading, failed to load, or ready. */
  readonly status: LoadStatus;
  readonly onRetry?: () => void;
}

/**
 * A week of days and the chosen day's open times, for a public booking page
 * (spec 0025, AC-630): the week's label with the weeks before and after, the
 * seven days as single choice toggles (a day with no times can't be chosen),
 * then the day's times as buttons, each moving on at once. Loading draws
 * skeleton tiles; an error offers a retry; a week with no time says so and
 * offers the next week.
 */
export function SlotPicker({
  weekLabel,
  days,
  selectedDayId,
  onSelectDay,
  slots,
  onPickSlot,
  onPreviousWeek,
  onNextWeek,
  canGoBack,
  canGoForward,
  status,
  onRetry,
}: SlotPickerProps) {
  const weekHasSlots = days.some((day) => day.hasSlots);
  const selected = days.find((day) => day.id === selectedDayId);
  return (
    <section className={styles.root} aria-label={strings.region}>
      <div className={styles.week}>
        <Button
          variant="ghost"
          icon="chevron-left"
          label={strings.previousWeek}
          isDisabled={!canGoBack || status === 'loading'}
          onPress={onPreviousWeek}
        />
        <h2 className={styles.weekLabel} aria-live="polite">
          {weekLabel}
        </h2>
        <Button
          variant="ghost"
          icon="chevron-right"
          label={strings.nextWeek}
          isDisabled={!canGoForward || status === 'loading'}
          onPress={onNextWeek}
        />
      </div>
      {status === 'error' ? (
        <EmptyState tone="error" title={strings.failedTitle} {...(onRetry === undefined ? {} : { onRetry })}>
          {strings.failedText}
        </EmptyState>
      ) : status === 'loading' ? (
        <div className={styles.loading} role="group" aria-busy="true" aria-label={strings.loading}>
          <div className={styles.days}>
            {days.map((day) => (
              <Skeleton key={day.id} shape="block" />
            ))}
          </div>
          <Skeleton lines={3} />
        </div>
      ) : (
        <>
          <ToggleButtonGroup
            className={styles.days}
            aria-label={strings.days}
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={selectedDayId === undefined ? [] : [selectedDayId]}
            onSelectionChange={(keys: Set<Key>) => {
              const [first] = [...keys];
              if (typeof first === 'string') onSelectDay(first);
            }}
          >
            {days.map((day) => (
              <AriaToggleButton
                key={day.id}
                id={day.id}
                className={styles.day}
                isDisabled={!day.hasSlots}
                aria-label={day.hasSlots ? day.label : `${day.label}, ${strings.noTimes}`}
              >
                <span className={styles.weekday}>{day.weekday}</span>
                <span className={styles.date}>{day.day}</span>
              </AriaToggleButton>
            ))}
          </ToggleButtonGroup>
          {!weekHasSlots ? (
            <EmptyState
              title={strings.emptyWeekTitle}
              actions={
                canGoForward ? (
                  <Button variant="secondary" iconRight="chevron-right" onPress={onNextWeek}>
                    {strings.nextWeekAction}
                  </Button>
                ) : undefined
              }
            >
              {strings.emptyWeekText}
            </EmptyState>
          ) : selected === undefined ? null : (
            <div className={styles.times}>
              <h3 className={styles.dayLabel}>{selected.label}</h3>
              {slots.length === 0 ? (
                <p className={styles.none}>{strings.noTimes}</p>
              ) : (
                <ul className={styles.slots} aria-label={strings.times(selected.label)}>
                  {slots.map((slot) => (
                    <li key={slot.id} className={styles.slot}>
                      <Button variant="secondary" isFullWidth="center" onPress={() => onPickSlot(slot.id)}>
                        {slot.label}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
