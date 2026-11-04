// Brief
// Purpose: a staff member's regular week at one place (spec 0066 B1, AC-6612): the library HoursEditor over their
// weekly shifts, and whether they may work outside the place's opening hours.
// Main task: set the week, saved as it changes, Copy times to and Set all days included.
// Leaves out: one date's change and time off (the Shifts grid), and the place's own opening hours.
import type { PlaceHours, ServicePlace, StaffPlaceView } from '@crm/data';
import { HoursEditor, Switch } from '@crm/ui';
import { useEffect, useRef, useState } from 'react';
import { dayName } from '../hospitality/strings.ts';
import { isWeekDay, weekRows, withDay, type EditorRange } from '../hospitality/hours-rows.ts';
import { strings } from './strings.ts';

/** Props for one place's regular week. */
export interface RegularShiftsProps {
  readonly name: string;
  readonly place: ServicePlace;
  readonly works: StaffPlaceView;
  readonly isReadOnly?: boolean;
  /** Saves the whole document; answers the refusal's words, or undefined. */
  readonly onSave: (shifts: PlaceHours, outsideHours: boolean) => Promise<string | undefined>;
}

/** The week, saved as it changes: one write however many days a Copy times to or Set all days touched. */
export function RegularShifts({ name, place, works, isReadOnly = false, onSave }: RegularShiftsProps) {
  const [problem, setProblem] = useState<{ readonly day: string; readonly message: string } | undefined>();
  const [typed, setTyped] = useState<{ readonly day: string; readonly ranges: readonly EditorRange[] } | undefined>();
  // Copy times to and Set all days call onChange once a day, in one go: each builds on the last (never on the hours
  // this render started from, or only the last day would stick), and one save goes once they have all landed.
  const latest = useRef(works.shifts);
  const pending = useRef(false);
  useEffect(() => {
    latest.current = works.shifts;
  }, [works.shifts]);
  const rows = weekRows(works.shifts, dayName).map((row) =>
    typed?.day === row.id
      ? { ...row, ranges: typed.ranges, ...(problem === undefined ? {} : { error: problem.message }) }
      : row,
  );
  return (
    <>
      <HoursEditor
        label={strings.regularTitle(name, place.name)}
        rows={rows}
        stepMinutes={15}
        isReadOnly={isReadOnly}
        onChange={(day, ranges) => {
          if (!isWeekDay(day)) return;
          const next = withDay(latest.current, day, ranges);
          if (next.problem !== undefined) {
            setTyped({ day, ranges });
            setProblem({ day, message: next.problem });
            return;
          }
          setTyped(undefined);
          setProblem(undefined);
          latest.current = next.hours;
          if (pending.current) return;
          pending.current = true;
          queueMicrotask(() => {
            pending.current = false;
            void onSave(latest.current, works.outsideHours);
          });
        }}
      />
      <Switch
        label={strings.outsideHours}
        description={strings.outsideHoursHint}
        isSelected={works.outsideHours}
        isDisabled={isReadOnly}
        onChange={(outside) => void onSave(latest.current, outside)}
      />
    </>
  );
}
