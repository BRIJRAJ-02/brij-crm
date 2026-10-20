import { useRef, useState } from 'react';
import { DialogTrigger } from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import { Checkbox } from '../../atoms/Checkbox/Checkbox.tsx';
import { Switch } from '../../atoms/Switch/Switch.tsx';
import { Tooltip } from '../../atoms/Tooltip/Tooltip.tsx';
import { Popover } from '../../molecules/Popover/Popover.tsx';
import { Select, type SelectItem } from '../../molecules/Select/Select.tsx';
import { memoIntl } from '../../lib/intl-memo.ts';
import { useFormatSettings } from '../../provider/context.ts';
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
 * Weekly hours (spec 0025 experience, AC-624, AC-680): an All days row at the
 * top ("Mixed" while days differ), then one row per day in the same columns: a
 * switch turns it on (09:00 to 17:00) or off, each window is a pair of fixed
 * width time Selects on a 30 minute step ("Midnight" the last end on a 12 hour
 * clock) with + to add another and − to remove one, and Copy times to puts
 * this day's windows on others.
 */
export function HoursEditor({
  label,
  rows,
  onChange,
  stepMinutes = 30,
  hourClock = '12',
  isDisabled = false,
  isReadOnly = false,
}: HoursEditorProps) {
  const { locale } = useFormatSettings();
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
  const setAll = (edge: 'start' | 'end', time: string) => {
    for (const row of on) {
      const ranges = row.ranges.map((range, index): HoursRange => {
        if (edge === 'start' && index === 0)
          return [time, minutesOf(range[1]) > minutesOf(time) ? range[1] : nextEnd(time)];
        if (edge === 'end' && index === row.ranges.length - 1)
          return [minutesOf(range[0]) < minutesOf(time) ? range[0] : prevStart(time), time];
        return range;
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
  return (
    <div className={styles.root}>
      {/* All days: the same columns as the days under it, a rule between, so it reads as acting on them. */}
      <div className={styles.all} role="group" aria-label={strings.allDays}>
        <span className={styles.allLabel} aria-hidden="true">
          {strings.allDays}
        </span>
        <div className={styles.range}>
          {time(strings.allStart, starts, allStart ?? null, (id) => setAll('start', id), on.length === 0)}
          {to}
          {time(strings.allEnd, ends, allEnd ?? null, (id) => setAll('end', id), on.length === 0)}
        </div>
      </div>
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
                {isOn ? (
                  row.ranges.map((range, index) => (
                    <div key={`${String(index)}-${range[0]}`} className={styles.range}>
                      {time(strings.from(row.label), starts, range[0], (id) => replace(index, [id, range[1]]))}
                      {to}
                      {time(strings.until(row.label), ends, range[1], (id) => replace(index, [range[0], id]))}
                      {index === 0 ? (
                        <Tooltip content={strings.addHint}>
                          <Button
                            variant="ghost"
                            icon="plus"
                            label={strings.addRange(row.label)}
                            isDisabled={isDisabled || !hasRoomAfter(row.ranges)}
                            onPress={() => onChange(row.id, [...row.ranges, nextRange(row.ranges)])}
                          />
                        </Tooltip>
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
