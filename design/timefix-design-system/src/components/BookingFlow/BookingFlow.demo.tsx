import { getLocalTimeZone, today as todayIn, type CalendarDate } from '@internationalized/date';
import { BookingFlow } from './BookingFlow.tsx';

const zones = [
  { id: 'Asia/Kolkata', label: 'India Standard Time' },
  { id: 'Europe/London', label: 'London (GMT)' },
  { id: 'America/New_York', label: 'Eastern Time (US)' },
  { id: 'America/Los_Angeles', label: 'Pacific Time (US)' },
  { id: 'Asia/Singapore', label: 'Singapore' },
];

// Weekdays are open; every fourth weekday is fully booked. A day loses a few times by a stable hash.
const seed = (d: CalendarDate) => d.year * 400 + d.month * 31 + d.day;
const weekday = (d: CalendarDate) => new Date(d.year, d.month - 1, d.day).getDay();
const isDayOpen = (d: CalendarDate) => weekday(d) !== 0 && weekday(d) !== 6 && seed(d) % 4 !== 0;
const slotsFor = (d: CalendarDate) => {
  if (!isDayOpen(d)) return [];
  const out: number[] = [];
  for (let m = 9 * 60; m <= 16 * 60 + 30; m += 30) if ((seed(d) + m / 30) % 5 !== 0 && m !== 13 * 60) out.push(m);
  return out;
};

export function BookingFlowDemo() {
  return (
    <div className="tf-demo tf-demo--canvas">
      <BookingFlow
        host={{ name: 'Priya Raman' }}
        title="Discovery call"
        durationMinutes={30}
        location={{ kind: 'video', label: 'Google Meet' }}
        today={todayIn(getLocalTimeZone())}
        isDayOpen={isDayOpen}
        slotsFor={slotsFor}
        timeZones={zones}
        defaultTimeZone="Asia/Kolkata"
        onBook={() => new Promise((resolve) => { window.setTimeout(resolve, 900); })}
      />
    </div>
  );
}
