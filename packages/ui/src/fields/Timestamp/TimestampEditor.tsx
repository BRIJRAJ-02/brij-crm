import { useRef, useState } from 'react';
import { formatClockOf, momentOf, momentParts } from '../../lib/moment.ts';
import { DatePicker } from '../../molecules/DatePicker/DatePicker.tsx';
import { Select, type SelectItem } from '../../molecules/Select/Select.tsx';
import { useFormatSettings, useNow } from '../../provider/context.ts';
import type { EditorProps } from '../types.ts';
import { isCompactSurface, toCommittable } from '../values.ts';
import { strings } from './strings.ts';

const pad = (value: number) => String(value).padStart(2, '0');

/** Times of day a quarter of an hour apart: what the time list offers (a value between them is added to it). */
const QUARTERS: readonly string[] = Array.from(
  { length: 96 },
  (_, index) => `${pad(Math.floor(index / 4))}:${pad((index % 4) * 15)}`,
);

/** The time a day starts with when it is picked before any time: the start of a working day. */
const FIRST_TIME = '09:00';

/**
 * Date and time (the field types pass, 31 October 2026): the day through the DatePicker, typed or picked, with Now
 * first among its quick picks, and the time of day from a list a quarter of an hour apart, both in the provider's
 * time zone. Each change commits at once (the day as the calendar closes or focus leaves it), so the cell's
 * popover stays open for the other half; the value stored is the moment in UTC.
 */
export function TimestampEditor({
  attribute,
  value,
  surface,
  onCommit,
  error,
  startText,
  isDisabled = false,
}: EditorProps<'timestamp'>) {
  const { locale, timeZone } = useFormatSettings();
  const now = useNow();
  const incoming = typeof value === 'string' ? value : null;
  const start = incoming === null ? undefined : momentParts(incoming, timeZone);
  const [date, setDate] = useState<string | null>(start?.date ?? null);
  const [time, setTime] = useState(start?.time ?? FIRST_TIME);
  // The latest day and time for the commit handlers, which can run before React draws the state just set.
  const latest = useRef({ date: start?.date ?? null, time: start?.time ?? FIRST_TIME });
  const committed = useRef(incoming);
  const [message, setMessage] = useState<string | undefined>(undefined);
  // A value changed from outside (live, or the screen refusing an edit) shows, as the date's editor does.
  const [shownValue, setShownValue] = useState(incoming);
  if (incoming !== shownValue) {
    setShownValue(incoming);
    const parts = incoming === null ? undefined : momentParts(incoming, timeZone);
    setDate(parts?.date ?? null);
    setTime(parts?.time ?? FIRST_TIME);
  }
  const isCompact = isCompactSurface(surface);
  const commit = (nextDate: string | null, nextTime: string) => {
    latest.current = { date: nextDate, time: nextTime };
    const moment = nextDate === null ? null : (momentOf(nextDate, nextTime, timeZone) ?? null);
    // Nothing new: what was last committed, or the value as it came in (from outside, unchanged since).
    if (moment === committed.current || moment === shownValue) return;
    const result = toCommittable<'timestamp'>(attribute, moment);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setMessage(undefined);
    committed.current = moment;
    onCommit(result.value);
  };
  const chooseDate = (next: string | null) => {
    latest.current = { ...latest.current, date: next };
    setDate(next);
  };
  const times: readonly SelectItem[] = [...new Set([...QUARTERS, time])]
    .sort()
    .map((each) => ({ id: each, label: formatClockOf(each, locale) }));
  const shown = message ?? error;
  return (
    <>
      <DatePicker
        label={attribute.name}
        isLabelHidden={isCompact}
        size={isCompact ? 'sm' : 'md'}
        isRequired={attribute.isRequired}
        isDisabled={isDisabled}
        // Opened by typing in a grid cell: the calendar opens with what was typed in Type a date.
        {...(startText === undefined ? {} : { startText, defaultOpen: true })}
        {...(isCompact ? {} : { hint: strings.hint })}
        value={date}
        {...(shown === undefined ? {} : { error: shown })}
        onChange={chooseDate}
        onFocusChange={(isFocused) => {
          if (!isFocused) commit(latest.current.date, latest.current.time);
        }}
        onOpenChange={(isOpen) => {
          if (!isOpen) commit(latest.current.date, latest.current.time);
        }}
        onNow={() => {
          const parts = momentParts(new Date(now).toISOString(), timeZone);
          if (parts === undefined) return;
          setDate(parts.date);
          setTime(parts.time);
          commit(parts.date, parts.time);
        }}
      />
      <Select
        label={strings.time(attribute.name)}
        isLabelHidden={isCompact}
        size={isCompact ? 'sm' : 'md'}
        variant="time"
        isSearchable
        searchLabel={strings.time(attribute.name)}
        items={times}
        // No day, no time: the list shows its placeholder rather than a time that reads as set.
        value={date === null ? null : time}
        placeholder={strings.noTime}
        isDisabled={isDisabled || date === null}
        onChange={(next) => {
          if (next === null) return;
          setTime(next);
          commit(latest.current.date, next);
        }}
      />
    </>
  );
}
