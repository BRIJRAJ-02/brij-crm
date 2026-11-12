import { useState } from 'react';
import { DayStrip, type StripDay } from './DayStrip.tsx';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LONG = new Intl.DateTimeFormat('en-US', { weekday: 'long', day: 'numeric', month: 'long' });
const TODAY = new Date(2026, 10, 11);
function week(offset: number): StripDay[] {
  return Array.from({ length: 7 }, (_, n) => {
    const d = new Date(2026, 10, 9 + offset * 7 + n);
    const key = d.getDate() + d.getMonth() * 31;
    return { id: d.toDateString(), weekday: WEEKDAYS[d.getDay()] ?? '', date: d.getDate(), label: LONG.format(d), count: d.getDay() % 6 === 0 ? 0 : (key * 7) % 5, isToday: d.toDateString() === TODAY.toDateString() };
  });
}

export function DayStripDemo() {
  const [offset, setOffset] = useState(0);
  const days = week(offset);
  const [value, setValue] = useState(TODAY.toDateString());
  const chosen = days.find((d) => d.id === value);
  const move = (by: number) => { const next = week(offset + by); setOffset(offset + by); setValue(next[0]?.id ?? ''); };
  return (
    <div className="tf-demo tf-stack">
      <DayStrip days={days} value={value} onChange={setValue} onPrevious={() => move(-1)} onNext={() => move(1)} />
      <p className="tf-muted" style={{ margin: 0, fontSize: 13 }}>
        {chosen ? `${chosen.label}: ${chosen.count === 0 ? 'no meetings' : `${chosen.count} meeting${chosen.count === 1 ? '' : 's'}`}` : 'Pick a day'}. Arrow keys move between days.
      </p>
    </div>
  );
}
