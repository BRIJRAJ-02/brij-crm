// Brief
// Purpose: days off (spec 0025 experience, AC-680): dates closed whatever the weekly hours say, in Availability and a page's own hours.
// Main task: see the upcoming ones, open one again, or add one (Add day off opens a small popover: the date and a note only the member sees). Availability shows the same rows inside its Time off card.
// Leaves out: dates with different hours (the data keeps them; this lists days off only) and every week on a weekday (turn the day off in the week).
import type { BookingAvailability } from '@crm/data';
import { Button, Card, DatePicker, EmptyState, Field, Form, Popover, Table, type TableColumn } from '@crm/ui';
import { useId, useRef, useState, type RefObject } from 'react';
import { dateLabel, openDay, todayIn, upcomingDaysOff, withDayOff } from './hours.ts';
import { strings } from './strings.ts';

const COLUMNS: readonly TableColumn[] = [
  { id: 'date', label: strings.dayOffColumns.date, isRowHeader: true },
  { id: 'why', label: strings.dayOffColumns.why },
  { id: 'actions', label: strings.dayOffColumns.actions, isLabelHidden: true, align: 'end' },
];

/** What the days off read and change: one availability, changed through `onChange`. */
export interface DaysOffSlot {
  readonly availability: BookingAvailability;
  readonly onChange: (availability: BookingAvailability) => void;
  /** Lists the days off with nothing to change (a page the reader can't change). */
  readonly isReadOnly?: boolean;
}

/** The days off still ahead in an availability, by its own zone's today. */
export const upcomingOf = (availability: BookingAvailability) =>
  upcomingDaysOff(availability, todayIn(availability.timeZone));

/**
 * The days off card for an availability (a page's own hours): the days off as rows, or one quiet line when there are
 * none, then Add day off under them. Availability folds the same rows into its Time off card (`DaysOffRows`,
 * `AddDayOff`), so a member has one place for the days they are away.
 */
export function DaysOff({ availability, onChange, isReadOnly = false }: DaysOffSlot) {
  const addRef = useRef<HTMLButtonElement>(null);
  return (
    <Card title={strings.daysOff}>
      {upcomingOf(availability).length === 0 ? (
        <EmptyState layout="row" icon="calendar" title={strings.noDaysOff} />
      ) : (
        <DaysOffRows
          availability={availability}
          onChange={onChange}
          isReadOnly={isReadOnly}
          onRemoved={() => addRef.current}
        />
      )}
      {!isReadOnly && <AddDayOff ref={addRef} availability={availability} onChange={onChange} />}
    </Card>
  );
}

/** The days off still ahead as rows (the date, its note, Remove); nothing when there are none. */
export function DaysOffRows({
  availability,
  onChange,
  isReadOnly = false,
  onRemoved,
}: DaysOffSlot & {
  /** Where focus goes once a removed day's row is gone: the control that always stays (Add day off). */
  readonly onRemoved: () => HTMLElement | null | undefined;
}) {
  const upcoming = upcomingOf(availability);
  if (upcoming.length === 0) return null;
  const columns = isReadOnly ? COLUMNS.filter((column) => column.id !== 'actions') : COLUMNS;
  return (
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
          day.note === undefined || day.note === '' ? (
            strings.dayOff
          ) : (
            day.note
          )
        ) : (
          <Button
            variant="ghost"
            icon="x"
            label={strings.removeDayOff(dateLabel(day.date))}
            onPress={() => {
              onChange(openDay(availability, day.date));
              // The row goes with its button: focus lands on the control that always stays.
              requestAnimationFrame(() => onRemoved()?.focus());
            }}
          />
        )
      }
    />
  );
}

/** Add day off, and the small popover it opens: the date and a note only the member sees. */
export function AddDayOff({
  ref,
  availability,
  onChange,
}: Omit<DaysOffSlot, 'isReadOnly'> & { readonly ref?: RefObject<HTMLButtonElement | null> }) {
  const [date, setDate] = useState<string | null>(null);
  const [why, setWhy] = useState('');
  const [dateError, setDateError] = useState<string | undefined>(undefined);
  const [isAdding, setAdding] = useState(false);
  const formId = useId();
  const ownRef = useRef<HTMLButtonElement>(null);
  const addRef = ref ?? ownRef;
  const dateField = () => document.getElementById(formId)?.querySelector<HTMLElement>('[role="spinbutton"]');
  const close = () => {
    setAdding(false);
    setDate(null);
    setWhy('');
    setDateError(undefined);
  };
  const today = todayIn(availability.timeZone);
  const add = () => {
    // Said on the field rather than a button that silently won't press, and a past day would vanish from the list.
    if (date === null || date < today) {
      setDateError(date === null ? strings.pickDate : strings.pickLaterDate);
      requestAnimationFrame(() => dateField()?.focus());
      return;
    }
    onChange(withDayOff(availability, date, why.trim()));
    close();
  };
  return (
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
          <Field label={strings.why} hint={strings.whyHint} name="why" value={why} onChange={setWhy} maxLength={120} />
          <Button variant="primary" type="submit" form={formId}>
            {strings.addDayOffCommit}
          </Button>
        </Form>
      </Popover>
    </>
  );
}
