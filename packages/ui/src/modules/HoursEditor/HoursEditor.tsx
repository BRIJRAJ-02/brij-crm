import { useRef, useState, type ReactNode } from 'react';
import { DialogTrigger } from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { Checkbox } from '../../atoms/Checkbox/Checkbox.tsx';
import { Switch } from '../../atoms/Switch/Switch.tsx';
import { Tooltip } from '../../atoms/Tooltip/Tooltip.tsx';
import { Popover } from '../../molecules/Popover/Popover.tsx';
import { Select } from '../../molecules/Select/SelectWithFaces.tsx';
import { type SelectItem } from '../../molecules/Select/Select.tsx';
import { memoIntl } from '../../lib/intl-memo.ts';
import { useFormatSettings } from '../../provider/context.ts';
import { useDelayedLoading } from '../../provider/useDelayedLoading.ts';
import styles from './HoursEditor.module.css';
import { strings } from './strings.ts';

/** One window of a day, local `HH:MM` times (`24:00` is midnight at its end), the end after the start. */
export type HoursRange = readonly [start: string, end: string];

/** One weekday's row. */
export interface HoursRow {
  readonly id: string;
  /** "Monday". */
  readonly label: string;
  /** Its windows; none is a day off. */
  readonly ranges: readonly HoursRange[];
  /** What's wrong with the row, said under it. */
  readonly error?: string;
}

/** Props for HoursEditor. */
export interface HoursEditorProps {
  /** What the rows are ("Weekly hours"), for screen readers. */
  readonly label: string;
  readonly rows: readonly HoursRow[];
  /** A row's new windows: one added, changed or removed, or none for a day off. */
  readonly onChange: (rowId: string, ranges: readonly HoursRange[]) => void;
  /** The times a window may start or end on, every this many minutes. Default 30. */
  readonly stepMinutes?: number;
  readonly isDisabled?: boolean;
  /** Shows the week as text, no controls: hours that come from elsewhere (a page that follows its member's). */
  readonly isReadOnly?: boolean;
  /**
   * The clock the times read in: `12` (the default, the owner's call: "9:30 AM" in every language) or `locale`,
   * the reader's own ("09:30" where the day runs to 24 hours).
   */
  readonly hourClock?: HoursClock;
  /**
   * The hours are still coming: one row per day and Set all days stand in their places, each with a skeleton where
   * its times go, so the editor arrives without the page under it moving. Pass the days as `rows` (no ranges).
   */
  readonly isLoading?: boolean;
  /**
   * One date's hours, not a week (the Team week's cell, spec 0037): Working on its own line, then the windows at full
   * width, with no Copy times to and no Set all days, since there is no other day to copy to or set. Sized by its
   * content, not as a container, so it opens whole in a popover. Give it the one row.
   */
  readonly isSingleDay?: boolean;
}

/** `HH:MM` for minutes from midnight. */
function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Which clock the times read in: `12` hours ("1:00 PM", the default) or the reader's own (`locale`). */
export type HoursClock = '12' | 'locale';

/** The formatter for a clock in a language, cached. */
function clockFormat(locale: string, hourClock: HoursClock): Intl.DateTimeFormat {
  return memoIntl(
    `hours-clock:${locale}:${hourClock}`,
    () =>
      new Intl.DateTimeFormat(locale, {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'UTC',
        ...(hourClock === '12' ? { hourCycle: 'h12' as const } : {}),
      }),
  );
}

/**
 * A stored `HH:MM` on the editor's clock: "9:30 AM" on the 12 hour clock, or the reader's own ("09:30" where the
 * day runs to 24 hours). The end of the day, `24:00`, is "Midnight" on a 12 hour clock (where "12:00 AM" would
 * read as the day's start) and "24:00" on a 24 hour one.
 */
function timeLabel(time: string, locale: string, hourClock: HoursClock): string {
  const format = clockFormat(locale, hourClock);
  if (time === '24:00') {
    const cycle = format.resolvedOptions().hourCycle;
    return cycle === 'h23' || cycle === 'h24' ? '24:00' : strings.midnight;
  }
  const minutes = minutesOf(time);
  return format.format(new Date(Date.UTC(2000, 0, 1, Math.floor(minutes / 60), minutes % 60)));
}

function minutesOf(time: string): number {
  const [hours = '0', minutes = '0'] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/** The window a new one takes: an hour after the day's last, an hour long, inside the day. */
function nextRange(ranges: readonly HoursRange[]): HoursRange {
  const last = ranges.at(-1);
  if (last === undefined) return ['09:00', '17:00'];
  const start = Math.min(minutesOf(last[1]) + 60, 1380);
  return [clock(start), clock(Math.min(start + 60, 1440))];
}

/** The whole day, 12:00 AM to Midnight, in one window. */
function isAllDay(ranges: readonly HoursRange[]): boolean {
  return ranges.length === 1 && ranges[0]?.[0] === '00:00' && ranges[0][1] === '24:00';
}

/** Whether the day has room for another window after its last: an hour's gap and half an hour, before midnight. */
function hasRoomAfter(ranges: readonly HoursRange[]): boolean {
  const last = ranges.at(-1);
  return ranges.length < 6 && (last === undefined || minutesOf(last[1]) <= 1440 - 90);
}

/** The one value every on day shares, or undefined when they differ ("Mixed"). */
function shared(values: readonly string[]): string | undefined {
  const [first] = values;
  return first !== undefined && values.every((value) => value === first) ? first : undefined;
}

/** Copy times to: the other days as checkboxes, Select all, and Apply. */
function CopyTo({
  from,
  rows,
  onApply,
  isDisabled,
}: {
  readonly from: HoursRow;
  readonly rows: readonly HoursRow[];
  readonly onApply: (rowIds: readonly string[]) => void;
  readonly isDisabled: boolean;
}) {
  const others = rows.filter((row) => row.id !== from.id);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [isOpen, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const all = chosen.size === others.length;
  return (
    <DialogTrigger
      isOpen={isOpen}
      onOpenChange={(open) => {
        setOpen(open);
        if (!open) setChosen(new Set());
      }}
    >
      <Tooltip content={strings.copyHint}>
        <Button ref={trigger} variant="ghost" icon="copy" label={strings.copyTo(from.label)} isDisabled={isDisabled} />
      </Tooltip>
      <Popover label={strings.copyTo(from.label)} triggerRef={trigger} placement="bottom end">
        <div className={styles.copyList}>
          <p className={styles.copyTitle}>{strings.copyTitle}</p>
          <Checkbox
            label={strings.selectAll}
            isSelected={all}
            isIndeterminate={chosen.size > 0 && !all}
            onChange={(isOn) => setChosen(isOn ? new Set(others.map((row) => row.id)) : new Set())}
          />
          {others.map((row) => (
            <Checkbox
              key={row.id}
              label={row.label}
              isSelected={chosen.has(row.id)}
              onChange={(isOn) =>
                setChosen((current) => {
                  const next = new Set(current);
                  if (isOn) next.add(row.id);
                  else next.delete(row.id);
                  return next;
                })
              }
            />
          ))}
          <Button
            variant="primary"
            isDisabled={chosen.size === 0}
            onPress={() => {
              onApply([...chosen]);
              setOpen(false);
              setChosen(new Set());
            }}
          >
            {strings.apply}
          </Button>
        </div>
      </Popover>
    </DialogTrigger>
  );
}

/**
 * Set all days: a quiet action under the week, opening a Popover with one start and one end for every day that is
 * on (its first window's start and its last window's end), and Apply. The days' shared times fill it, else 9 to 5.
 */
function SetAll({
  start,
  end,
  isDisabled,
  time,
  starts,
  ends,
  to,
  onApply,
}: {
  readonly start: string;
  readonly end: string;
  readonly isDisabled: boolean;
  readonly time: (
    name: string,
    items: readonly SelectItem[],
    value: string | null,
    onPick: (id: string) => void,
  ) => ReactNode;
  readonly starts: readonly SelectItem[];
  readonly ends: readonly SelectItem[];
  readonly to: ReactNode;
  readonly onApply: (start: string, end: string) => void;
}) {
  const [isOpen, setOpen] = useState(false);
  const [from, setFrom] = useState(start);
  const [until, setUntil] = useState(end);
  const trigger = useRef<HTMLButtonElement>(null);
  const isValid = minutesOf(until) > minutesOf(from);
  return (
    <DialogTrigger
      isOpen={isOpen}
      onOpenChange={(open) => {
        setOpen(open);
        // Each opening starts from the week as it is.
        if (open) {
          setFrom(start);
          setUntil(end);
        }
      }}
    >
      <Button ref={trigger} variant="ghost" size="sm" icon="clock" isDisabled={isDisabled}>
        {strings.setAll}
      </Button>
      <Popover label={strings.setAll} triggerRef={trigger} placement="bottom start">
        <div className={styles.copyList}>
          <p className={styles.copyTitle}>{strings.setAllTitle}</p>
          <div className={styles.range}>
            {time(strings.allStart, starts, from, setFrom)}
            {to}
            {time(strings.allEnd, ends, until, setUntil)}
          </div>
          <Button
            variant="primary"
            isDisabled={!isValid}
            onPress={() => {
              onApply(from, until);
              setOpen(false);
            }}
          >
            {strings.apply}
          </Button>
        </div>
      </Popover>
    </DialogTrigger>
  );
}

/**
 * Weekly hours (spec 0025 experience, AC-624, AC-680): one row per day: a
 * switch turns it on (09:00 to 17:00) or off, each window is a pair of fixed
 * width time Selects on a 30 minute step ("Midnight" the last end on a 12 hour
 * clock) with + to add another and − to remove one, and Copy times to puts
 * this day's windows on others. Set all days, under the week, sets every on
 * day's start and end at once.
 */
export function HoursEditor({
  label,
  rows,
  onChange,
  stepMinutes = 30,
  hourClock = '12',
  isDisabled = false,
  isReadOnly = false,
  isLoading = false,
  isSingleDay = false,
}: HoursEditorProps) {
  const { locale } = useFormatSettings();
  const showSkeleton = useDelayedLoading(isLoading);
  if (isLoading) {
    return (
      <div className={styles.root} aria-busy="true">
        <ul className={styles.rows} aria-label={label}>
          {rows.map((row) => (
            <li key={row.id} className={styles.row}>
              <div className={styles.day}>{row.label}</div>
              <span className={styles.slot}>{showSkeleton && <Skeleton />}</span>
            </li>
          ))}
        </ul>
        <div className={styles.setAll}>
          <Button variant="ghost" size="sm" icon="clock" isDisabled>
            {strings.setAll}
          </Button>
        </div>
      </div>
    );
  }
  if (isReadOnly) return <ReadOnlyWeek label={label} rows={rows} locale={locale} hourClock={hourClock} />;
  const step = stepMinutes > 0 ? stepMinutes : 30;
  const starts: SelectItem[] = [];
  const ends: SelectItem[] = [];
  for (let minutes = 0; minutes <= 1440; minutes += step) {
    if (minutes < 1440) starts.push({ id: clock(minutes), label: timeLabel(clock(minutes), locale, hourClock) });
    if (minutes > 0) ends.push({ id: clock(minutes), label: timeLabel(clock(minutes), locale, hourClock) });
  }
  const on = rows.filter((row) => row.ranges.length > 0);
  const allStart = shared(on.map((row) => row.ranges[0]?.[0] ?? ''));
  const allEnd = shared(on.map((row) => row.ranges.at(-1)?.[1] ?? ''));
  // Sets every on day's first start and last end at once, each window kept the right way round.
  const setAll = (start: string, end: string) => {
    for (const row of on) {
      const last = row.ranges.length - 1;
      const ranges = row.ranges.map((range, index): HoursRange => {
        const from = index === 0 ? start : range[0];
        const until = index === last ? end : range[1];
        if (minutesOf(until) > minutesOf(from)) return [from, until];
        return index === last ? [prevStart(until), until] : [from, nextEnd(from)];
      });
      onChange(row.id, ranges);
    }
  };
  // A time Select: one fixed width, so "to" and the buttons sit on one line down the week and never move.
  const time = (
    name: string,
    items: readonly SelectItem[],
    value: string | null,
    onPick: (id: string) => void,
    isOff = false,
  ) => (
    <Select
      label={name}
      isLabelHidden
      size="sm"
      variant="time"
      items={items}
      value={value}
      placeholder={strings.mixed}
      isDisabled={isDisabled || isOff}
      onChange={(id) => {
        if (id !== null) onPick(id);
      }}
    />
  );
  const to = (
    <span className={styles.to} aria-hidden="true">
      {strings.to}
    </span>
  );
  if (isSingleDay) {
    const row = rows[0];
    return row === undefined ? null : (
      <SingleDay
        row={row}
        label={label}
        isDisabled={isDisabled}
        onChange={onChange}
        time={time}
        to={to}
        starts={starts}
        ends={ends}
        locale={locale}
        hourClock={hourClock}
      />
    );
  }
  return (
    <div className={styles.root}>
      <ul className={styles.rows} aria-label={label}>
        {rows.map((row) => {
          const isOn = row.ranges.length > 0;
          const replace = (index: number, range: HoursRange) =>
            onChange(
              row.id,
              row.ranges.map((each, at) => (at === index ? range : each)),
            );
          return (
            <li key={row.id} className={styles.row} data-off={isOn ? undefined : ''}>
              <div className={styles.day}>
                <Switch
                  label={row.label}
                  isSelected={isOn}
                  isDisabled={isDisabled}
                  onChange={(selected) => onChange(row.id, selected ? [nextRange([])] : [])}
                />
              </div>
              <div className={styles.ranges}>
                {isAllDay(row.ranges) ? (
                  // 12:00 AM to Midnight reads as what it is, with a way back to hours.
                  <span className={styles.allDay}>
                    {strings.allDay}
                    <Button
                      variant="ghost"
                      size="sm"
                      label={strings.setHoursFor(row.label)}
                      isDisabled={isDisabled}
                      onPress={() => onChange(row.id, [nextRange([])])}
                    >
                      {strings.setHours}
                    </Button>
                  </span>
                ) : isOn ? (
                  row.ranges.map((range, index) => (
                    <div key={`${String(index)}-${range[0]}`} className={styles.range}>
                      {time(strings.from(row.label, index + 1), starts, range[0], (id) =>
                        replace(index, [id, range[1]]),
                      )}
                      {to}
                      {time(strings.until(row.label, index + 1), ends, range[1], (id) =>
                        replace(index, [range[0], id]),
                      )}
                      {index === 0 ? (
                        // No room for another window (the day runs to its end): no + at all, rather than one off
                        // with no way to say why (the owner, 22 October 2026).
                        hasRoomAfter(row.ranges) && (
                          <Tooltip content={strings.addHint}>
                            <Button
                              variant="ghost"
                              icon="plus"
                              label={strings.addRange(row.label)}
                              isDisabled={isDisabled}
                              onPress={() => onChange(row.id, [...row.ranges, nextRange(row.ranges)])}
                            />
                          </Tooltip>
                        )
                      ) : (
                        <Tooltip content={strings.removeHint}>
                          <Button
                            variant="ghost"
                            icon="minus"
                            label={strings.removeRange(
                              row.label,
                              timeLabel(range[0], locale, hourClock),
                              timeLabel(range[1], locale, hourClock),
                            )}
                            isDisabled={isDisabled}
                            onPress={() =>
                              onChange(
                                row.id,
                                row.ranges.filter((_, at) => at !== index),
                              )
                            }
                          />
                        </Tooltip>
                      )}
                    </div>
                  ))
                ) : (
                  <span className={styles.offLabel}>{strings.unavailable}</span>
                )}
                {row.error !== undefined && (
                  <p className={styles.error} role="alert">
                    {row.error}
                  </p>
                )}
              </div>
              {isOn && (
                <div className={styles.copy}>
                  <CopyTo
                    from={row}
                    rows={rows}
                    isDisabled={isDisabled}
                    onApply={(ids) => {
                      for (const id of ids) onChange(id, row.ranges);
                    }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className={styles.setAll}>
        <SetAll
          start={allStart ?? '09:00'}
          end={allEnd ?? '17:00'}
          isDisabled={isDisabled || on.length === 0}
          time={time}
          starts={starts}
          ends={ends}
          to={to}
          onApply={setAll}
        />
      </div>
    </div>
  );
}

/**
 * One date's hours (`isSingleDay`, the Team week's cell): Working on one line, then each window on its own line, its
 * start, "to" and end at full width with + (the first) or − (the others) after them. An end is offered only after its
 * start, and a start moved past its end takes the end an hour on, so a window never turns inside out.
 */
function SingleDay({
  row,
  label,
  isDisabled,
  onChange,
  time,
  to,
  starts,
  ends,
  locale,
  hourClock,
}: {
  readonly row: HoursRow;
  readonly label: string;
  readonly isDisabled: boolean;
  readonly onChange: (rowId: string, ranges: readonly HoursRange[]) => void;
  readonly time: (
    name: string,
    items: readonly SelectItem[],
    value: string | null,
    onPick: (id: string) => void,
  ) => ReactNode;
  readonly to: ReactNode;
  readonly starts: readonly SelectItem[];
  readonly ends: readonly SelectItem[];
  readonly locale: string;
  readonly hourClock: HoursClock;
}) {
  const isOn = row.ranges.length > 0;
  const replace = (index: number, range: HoursRange) =>
    onChange(
      row.id,
      row.ranges.map((each, at) => (at === index ? range : each)),
    );
  return (
    <div className={styles.single}>
      <Switch
        label={strings.working}
        isSelected={isOn}
        isDisabled={isDisabled}
        onChange={(selected) => onChange(row.id, selected ? [nextRange([])] : [])}
      />
      {isOn && (
        <ul className={styles.singleRanges} aria-label={label}>
          {row.ranges.map((range, index) => (
            <li key={`${String(index)}-${range[0]}`} className={styles.range}>
              {time(strings.from(row.label, index + 1), starts, range[0], (id) =>
                replace(index, [id, minutesOf(range[1]) > minutesOf(id) ? range[1] : nextEnd(id)]),
              )}
              {to}
              {time(
                strings.until(row.label, index + 1),
                ends.filter((item) => minutesOf(item.id) > minutesOf(range[0])),
                range[1],
                (id) => replace(index, [range[0], id]),
              )}
              {index === 0 ? (
                hasRoomAfter(row.ranges) && (
                  <Tooltip content={strings.addHint}>
                    <Button
                      variant="ghost"
                      icon="plus"
                      label={strings.addRange(row.label)}
                      isDisabled={isDisabled}
                      onPress={() => onChange(row.id, [...row.ranges, nextRange(row.ranges)])}
                    />
                  </Tooltip>
                )
              ) : (
                <Tooltip content={strings.removeHint}>
                  <Button
                    variant="ghost"
                    icon="minus"
                    label={strings.removeRange(
                      row.label,
                      timeLabel(range[0], locale, hourClock),
                      timeLabel(range[1], locale, hourClock),
                    )}
                    isDisabled={isDisabled}
                    onPress={() =>
                      onChange(
                        row.id,
                        row.ranges.filter((_, at) => at !== index),
                      )
                    }
                  />
                </Tooltip>
              )}
            </li>
          ))}
        </ul>
      )}
      {row.error !== undefined && (
        <p className={styles.error} role="alert">
          {row.error}
        </p>
      )}
    </div>
  );
}

/** A window as text, "9:00 AM to 5:00 PM" ("Midnight" at its end). */
const rangeText = ([start, end]: HoursRange, locale: string, hourClock: HoursClock): string =>
  `${timeLabel(start, locale, hourClock)} ${strings.to} ${timeLabel(end, locale, hourClock)}`;

/** The week as text: each day's windows, or Unavailable. */
function ReadOnlyWeek({
  label,
  rows,
  locale,
  hourClock,
}: {
  readonly label: string;
  readonly rows: readonly HoursRow[];
  readonly locale: string;
  readonly hourClock: HoursClock;
}) {
  return (
    <ul className={styles.rows} aria-label={label} data-read-only="">
      {rows.map((row) => (
        <li key={row.id} className={styles.row} data-off={row.ranges.length > 0 ? undefined : ''}>
          <span className={styles.dayName}>{row.label}</span>
          <span className={styles.ranges}>
            {row.ranges.length > 0 ? (
              row.ranges.map((range) => (
                <span key={range[0]} className={styles.rangeText}>
                  {rangeText(range, locale, hourClock)}
                </span>
              ))
            ) : (
              <span className={styles.offLabel}>{strings.unavailable}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The step after a start, for an end moved before it. */
function nextEnd(start: string): string {
  return clock(Math.min(minutesOf(start) + 60, 1440));
}

/** The step before an end, for a start moved after it. */
function prevStart(end: string): string {
  return clock(Math.max(minutesOf(end) - 60, 0));
}
