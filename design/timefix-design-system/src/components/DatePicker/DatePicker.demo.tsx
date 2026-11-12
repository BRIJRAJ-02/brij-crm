import { useState } from 'react';
import { today, getLocalTimeZone, isWeekend, type CalendarDate, type DateValue } from '@internationalized/date';
import { Calendar, DatePicker, DateRangePicker, DateNav, defaultPresets, type DateView } from './DatePicker.tsx';

export function DatePickerDemo() {
  const now = today(getLocalTimeZone());
  const [day, setDay] = useState<CalendarDate>(now.add({ days: 2 }));
  const [navDate, setNavDate] = useState<CalendarDate>(now);
  const [view, setView] = useState<DateView>('week');
  const [range, setRange] = useState<{ start: CalendarDate; end: CalendarDate } | null>(() => {
    const p = defaultPresets(now)[2];
    return p ? { start: p.start, end: p.end } : null;
  });
  const unavailable = (d: DateValue) => isWeekend(d, 'en-GB') || d.compare(now) < 0;
  return (
    <div className="tf-demo tf-stack" style={{ gap: 'var(--space-20)' }}>
      <DateNav date={navDate} onDateChange={setNavDate} view={view} onViewChange={setView} enableShortcuts />
      <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: 'var(--space-32)', alignItems: 'start' }}>
        <div className="tf-stack" style={{ gap: 'var(--space-4)' }}>
          <p className="tf-demo-label">Booking calendar (weekends unavailable)</p>
          <Calendar aria-label="Pick a day for Discovery call" value={day} onChange={setDay} isDateUnavailable={unavailable} minValue={now} />
        </div>
        <div className="tf-stack" style={{ gap: 'var(--space-20)', maxWidth: 340 }}>
          <DatePicker label="Follow-up date" defaultValue={now.add({ days: 7 })} description="We'll remind you on the morning." />
          <DateRangePicker label="Bookings between" value={range} onChange={setRange} />
          <DatePicker label="Contract end" isInvalid errorMessage="Pick a date after the start." />
        </div>
      </div>
    </div>
  );
}
