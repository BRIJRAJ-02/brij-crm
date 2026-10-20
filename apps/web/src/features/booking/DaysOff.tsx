// Brief
// Purpose: days off (spec 0025 experience, AC-680): dates closed whatever the weekly hours say, in Availability and a page's own hours.
// Main task: see the upcoming ones, open one again, or add one with a reason only the member sees.
// Leaves out: dates with different hours (the data keeps them; this lists days off only) and every week on a weekday (turn the day off in the week).
import type { BookingAvailability } from '@crm/data';
import { Button, Card, DatePicker, Field, Form, Separator, Table, type TableColumn } from '@crm/ui';
import { useId, useState } from 'react';
import { dateLabel, openDay, todayIn, upcomingDaysOff, withDayOff } from './hours.ts';
import { strings } from './strings.ts';

const COLUMNS: readonly TableColumn[] = [
  { id: 'date', label: strings.dayOffColumns.date, isRowHeader: true },
  { id: 'why', label: strings.dayOffColumns.why },
  { id: 'actions', label: strings.dayOffColumns.actions, isLabelHidden: true, align: 'end' },
];

/** The days off card for an availability, changed through `onChange`. */
export function DaysOff({
  availability,
  onChange,
  isReadOnly = false,
}: {
  readonly availability: BookingAvailability;
  readonly onChange: (availability: BookingAvailability) => void;
  /** Lists the days off with nothing to change (a page the reader can't change). */
  readonly isReadOnly?: boolean;
}) {
  const [date, setDate] = useState<string | null>(null);
  const [why, setWhy] = useState('');
  const [dateError, setDateError] = useState<string | undefined>(undefined);
  const formId = useId();
  // Where focus goes when the control that had it is gone (an opened day's row) or a field needs fixing.
  // The card's body, found through the add form, which sits in it beside the list.
  const focusLater = (pick: (root: HTMLElement) => HTMLElement | null | undefined) => {
    requestAnimationFrame(() => {
      const root = document.getElementById(formId)?.parentElement;
      if (root !== null && root !== undefined) pick(root)?.focus();
    });
  };
  const dateField = (root: HTMLElement) => root.querySelector<HTMLElement>('[role="spinbutton"]');
  const today = todayIn(availability.timeZone);
  const upcoming = upcomingDaysOff(availability, today);
  const add = () => {
    // Said on the field rather than a button that silently won't press, and a past day would vanish from the list.
    if (date === null || date < today) {
      setDateError(date === null ? strings.pickDate : strings.pickLaterDate);
      focusLater(dateField);
      return;
    }
    onChange(withDayOff(availability, date, why.trim()));
    setDate(null);
    setWhy('');
    setDateError(undefined);
  };
  const columns = isReadOnly ? COLUMNS.filter((column) => column.id !== 'actions') : COLUMNS;
  return (
    <Card title={strings.daysOff} description={strings.daysOffCount(upcoming.length)}>
      {upcoming.length > 0 && (
        <Table
          label={strings.daysOff}
          columns={columns}
          rows={upcoming}
          getRowId={(day) => day.date}
          renderCell={(day, column) =>
            column === 'date' ? (
              dateLabel(day.date)
            ) : column === 'why' ? (
              (day.note ?? '')
            ) : (
              <Button
                variant="ghost"
                onPress={() => {
                  const index = upcoming.findIndex((each) => each.date === day.date);
                  onChange(openDay(availability, day.date));
                  // The row goes with its button: focus the next day's Open (or the last), else the date to add one.
                  focusLater((root) => {
                    const opens = [...root.querySelectorAll<HTMLElement>('table button')];
                    return opens[Math.min(index, opens.length - 1)] ?? dateField(root);
                  });
                }}
              >
                {strings.openDay}
              </Button>
            )
          }
        />
      )}
      {!isReadOnly && upcoming.length > 0 && <Separator />}
      {!isReadOnly && (
        <Form id={formId} label={strings.addDayOff} onSubmit={add}>
          <DatePicker
            label={strings.dayOffDate}
            value={date}
            onChange={(next) => {
              setDate(next);
              setDateError(undefined);
            }}
            {...(dateError === undefined ? {} : { error: dateError })}
          />
          <Field label={strings.why} name="why" value={why} onChange={setWhy} maxLength={120} />
          <Button icon="plus" type="submit" form={formId}>
            {strings.addDayOff}
          </Button>
        </Form>
      )}
    </Card>
  );
}
