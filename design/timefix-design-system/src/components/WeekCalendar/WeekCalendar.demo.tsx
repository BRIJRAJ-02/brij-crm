import { useState } from 'react';
import { WeekCalendar, formatClockRange, type WeekEvent, type WeekSelection } from './WeekCalendar.tsx';
import { formatLongDay } from '../../lib/format.ts';

/** Monday 9 to Friday 13 November 2026, labelled through the shared date format; Wednesday is today. */
const days = [9, 10, 11, 12, 13].map((n) => {
  const d = new Date(2026, 10, n);
  return { weekday: formatLongDay(d).slice(0, 3), date: n, label: formatLongDay(d), isToday: n === 11 };
});
const h = (hh: number, mm = 0) => hh * 60 + mm;
const seed: ReadonlyArray<WeekEvent> = [
  { id: 'e1', day: 0, start: h(9), end: h(9, 30), title: 'Discovery call', kind: 'meeting', guests: ['Priya Raman', 'Sam Kim'], location: 'Google Meet' },
  { id: 'e2', day: 0, start: h(11), end: h(12), title: 'Weekly planning', kind: 'internal', guests: ['Priya Raman', 'Jo Mendes', 'Ava Chen', 'Maria Bell', 'Sam Kim'] },
  { id: 'e3', day: 1, start: h(10), end: h(10, 45), title: 'Demo · Northwind', kind: 'meeting', guests: ['Ava Chen', 'Jo Mendes'], location: 'Zoom' },
  { id: 'e4', day: 1, start: h(14), end: h(15, 30), title: 'Site visit · Acme Corp', kind: 'in-person', guests: ['Maria Bell'], location: '12 Harbour Street' },
  { id: 'e5', day: 2, start: h(9, 30), end: h(10), title: 'Stand-up', kind: 'internal', guests: ['Priya Raman', 'Sam Kim', 'Jo Mendes'] },
  { id: 'e6', day: 2, start: h(13), end: h(13, 45), title: 'Demo · Globex', kind: 'meeting', guests: ['Sam Kim'], location: 'Google Meet' },
  { id: 'e7', day: 2, start: h(13, 30), end: h(14), title: 'Intro · Initech', kind: 'meeting', guests: ['Ava Chen'], location: 'Google Meet' },
  { id: 'e8', day: 3, start: h(11, 30), end: h(12, 30), title: 'Discovery call', kind: 'meeting', guests: ['Jo Mendes'], location: 'Google Meet' },
  { id: 'e9', day: 4, start: h(10), end: h(10, 30), title: 'Renewal · Acme Corp', kind: 'meeting', guests: ['Priya Raman'], location: 'Phone' },
];
const busy = [
  { id: 'b1', day: 1, start: h(12), end: h(13), source: 'Google Calendar' },
  { id: 'b2', day: 3, start: h(12), end: h(13, 30), source: 'Outlook' },
  { id: 'b3', day: 4, start: h(14), end: h(17), source: 'Google Calendar' },
];

export function WeekCalendarDemo() {
  const [sel, setSel] = useState<WeekSelection>();
  const [events, setEvents] = useState(seed);
  const [moved, setMoved] = useState<string>();
  return (
    <div className="tf-demo tf-stack">
      <WeekCalendar days={days} events={events} busy={busy} now={{ day: 2, minutes: h(11, 40) }} onSelect={setSel}
        onEventChange={(ev, next) => { setEvents((list) => list.map((e) => (e.id === ev.id ? { ...e, ...next } : e))); setMoved(`${ev.title} moved to ${days[next.day]?.label ?? ''}, ${formatClockRange(next.start, next.end)}.`); }} />
      <p className="tf-muted" style={{ margin: 0, fontSize: 13 }}>
        {sel ? <>New meeting on {days[sel.day]?.label}, <span className="tf-num">{formatClockRange(sel.start, sel.end)}</span>. Esc clears it.</> : moved ?? 'Drag on empty space to pick a time. Drag an event to move it, or its bottom edge to change its length; Esc cancels. By keyboard: focus an event, Enter, arrows, Enter.'}
      </p>
    </div>
  );
}
