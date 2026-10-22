// Brief
// Purpose: days off (spec 0025 experience, AC-680): dates closed whatever the weekly hours say, in Availability and a page's own hours.
// Main task: see the upcoming ones, open one again, or add one (Add day off opens a small popover: the date and a note only the member sees).
// Leaves out: dates with different hours (the data keeps them; this lists days off only) and every week on a weekday (turn the day off in the week).
import type { BookingAvailability } from '@crm/data';
import { Button, Card, DatePicker, EmptyState, Field, Form, Popover, Table, type TableColumn } from '@crm/ui';
import { useId, useRef, useState } from 'react';
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
  const [isAdding, setAdding] = useState(false);
  const formId = useId();
  const addRef = useRef<HTMLButtonElement>(null);
  // Where focus goes when the control that had it is gone (an opened day's row) or a field needs fixing.
  const focusLater = (pick: () => HTMLElement | null | undefined) => {
    requestAnimationFrame(() => pick()?.focus());
  };
  const dateField = () => document.getElementById(formId)?.querySelector<HTMLElement>('[role="spinbutton"]');
  const close = () => {
    setAdding(false);
    setDate(null);
    setWhy('');
    setDateError(undefined);
  };
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
    close();
  };
  const columns = isReadOnly ? COLUMNS.filter((column) => column.id !== 'actions') : COLUMNS;
  // One card anatomy with Used by (the owner, 22 October 2026): the title, then the days off as rows (the date, its
  // note, Remove), or one quiet line when there are none, then Add day off under them.
  return (
    <Card title={strings.daysOff}>
      {upcoming.length === 0 ? (
        <EmptyState layout="row" icon="calendar" title={strings.noDaysOff} />
      ) : (
        <Table
          label={strings.daysOff}
          columns={columns}
          rows={upcoming}
          isHeaderHidden
          getRowId={(day) => day.date}
          renderCell={(day, column) =>
            column === 'date' ? (
              dateLabel(day.date)
            ) : column === 'why' ? (
              (day.note ?? '')
            ) : (
              <Button
                variant="ghost"
                icon="x"
                label={strings.removeDayOff(dateLabel(day.date))}
                onPress={() => {
                  onChange(openDay(availability, day.date));
                  // The row goes with its button: focus lands on Add day off, which always stays.
                  focusLater(() => addRef.current);
                }}
              />
            )
          }
        />
      )}
      {!isReadOnly && (
        <>
          <Button ref={addRef} icon="plus" onPress={() => setAdding(true)}>
            {strings.addDayOff}
          </Button>
          <Popover
            label={strings.addDayOff}
            triggerRef={addRef}
            isOpen={isAdding}
            onOpenChange={(open) => {
              if (!open) close();
            }}
          >
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
              <Field
                label={strings.why}
                hint={strings.whyHint}
                name="why"
                value={why}
                onChange={setWhy}
                maxLength={120}
              />
              <Button variant="primary" type="submit" form={formId}>
                {strings.addDayOffCommit}
              </Button>
            </Form>
          </Popover>
        </>
      )}
    </Card>
  );
}
