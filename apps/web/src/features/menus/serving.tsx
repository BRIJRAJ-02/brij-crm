// Serving times in the editor (spec 0065, AC-6520, AC-6521; checklabs' per day schedule and menu times): a switch,
// and when it is on, the week as the library's HoursEditor draws a place's hours, filled at first from the place's
// own hours (never a made up Sat and Sun brunch), so a first try already matches when the place is open.
import type { MenuServing, PlaceHours } from '@crm/data';
import { WEEK_DAYS } from '@crm/data/menu';
import { HoursEditor, Switch } from '@crm/ui';
import { useState } from 'react';
import { isWeekDay, weekRows, withDay, type EditorRange } from '../hospitality/hours-rows.ts';
import { strings } from './strings.ts';

/** How late a serving window may run into the next morning, as a place's hours. */
const LATE_UNTIL = '06:00';

/** Serving times to start from: the place's week (every day written, so a day it is closed stays closed), else noon to ten. */
export function defaultServing(placeHours: PlaceHours | undefined): MenuServing {
  const hasAny = placeHours !== undefined && WEEK_DAYS.some((day) => (placeHours.weekly[day] ?? []).length > 0);
  return {
    weekly: Object.fromEntries(
      WEEK_DAYS.map((day) => [
        day,
        hasAny
          ? (placeHours.weekly[day] ?? []).map(({ from, to }) => ({ from, to }))
          : [{ from: '12:00', to: '22:00' }],
      ]),
    ),
  };
}

/** Serving times' switch and week. `onChange(null)` clears them; a week that doesn't hold together isn't sent. */
export function ServingEditor({
  label,
  hint,
  value,
  placeHours,
  isReadOnly = false,
  onChange,
}: {
  readonly label: string;
  readonly hint: string;
  readonly value: MenuServing | undefined;
  readonly placeHours: PlaceHours | undefined;
  readonly isReadOnly?: boolean;
  readonly onChange: (next: MenuServing | null) => void;
}) {
  const [held, setHeld] = useState<{ day: string; ranges: readonly EditorRange[]; message: string }>();
  const hours: PlaceHours | undefined = value === undefined ? undefined : { weekly: value.weekly, exceptions: [] };
  return (
    <>
      <Switch
        label={label}
        description={hint}
        isSelected={value !== undefined}
        isReadOnly={isReadOnly}
        onChange={(on) => onChange(on ? defaultServing(placeHours) : null)}
      />
      {hours === undefined ? null : (
        <HoursEditor
          label={strings.servingWeek}
          rows={weekRows(hours, (day) => strings.dayNames[day]).map((row) =>
            held?.day === row.id ? { ...row, ranges: held.ranges, error: held.message } : row,
          )}
          pastMidnightUntil={LATE_UNTIL}
          isReadOnly={isReadOnly}
          onChange={(day, ranges) => {
            if (!isWeekDay(day)) return;
            const next = withDay(hours, day, ranges);
            // A week that doesn't hold together stays on screen as typed, with why, until it does.
            if (next.problem !== undefined) {
              setHeld({ day, ranges, message: next.problem });
              return;
            }
            setHeld(undefined);
            onChange({ weekly: Object.fromEntries(WEEK_DAYS.map((each) => [each, next.hours.weekly[each] ?? []])) });
          }}
        />
      )}
    </>
  );
}
