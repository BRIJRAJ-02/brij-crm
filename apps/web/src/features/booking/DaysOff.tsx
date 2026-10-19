// Brief
// Purpose: days off (spec 0025 experience, AC-680): dates closed whatever the weekly hours say, in Availability and a page's own hours.
// Main task: see the upcoming ones, open one again, or add one with a reason only the member sees.
// Leaves out: dates with different hours (the data keeps them; this lists days off only) and every week on a weekday (turn the day off in the week).
import type { BookingAvailability } from '@crm/data';
import { Button, Card, DatePicker, Field, Table, type TableColumn } from '@crm/ui';
import { useState } from 'react';
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
}: {
  readonly availability: BookingAvailability;
  readonly onChange: (availability: BookingAvailability) => void;
}) {
  const [date, setDate] = useState<string | null>(null);
  const [why, setWhy] = useState('');
  const upcoming = upcomingDaysOff(availability, todayIn(availability.timeZone));
  return (
    <Card title={strings.daysOff} description={strings.daysOffCount(upcoming.length)}>
      {upcoming.length > 0 && (
        <Table
          label={strings.daysOff}
          columns={COLUMNS}
          rows={upcoming}
          getRowId={(day) => day.date}
          renderCell={(day, column) =>
            column === 'date' ? (
              dateLabel(day.date)
            ) : column === 'why' ? (
              (day.note ?? '')
            ) : (
              <Button variant="ghost" onPress={() => onChange(openDay(availability, day.date))}>
                {strings.openDay}
              </Button>
            )
          }
        />
      )}
      <DatePicker label={strings.dayOffDate} value={date} onChange={setDate} />
      <Field label={strings.why} value={why} onChange={setWhy} maxLength={120} />
      <Button
        icon="plus"
        isDisabled={date === null}
        onPress={() => {
          if (date === null) return;
          onChange(withDayOff(availability, date, why.trim()));
          setDate(null);
          setWhy('');
        }}
      >
        {strings.addDayOff}
      </Button>
    </Card>
  );
}
