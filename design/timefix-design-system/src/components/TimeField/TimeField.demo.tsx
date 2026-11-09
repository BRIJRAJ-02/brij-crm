import { useState } from 'react';
import { Time } from '@internationalized/date';
import { TimeSelect, TimeField, formatTime, type HourCycle } from './TimeField.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';

type Hours = { readonly on: boolean; readonly start: string; readonly end: string };
const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const toMin = (v: string) => { const [h = 0, m = 0] = v.split(':').map(Number); return h * 60 + m; };

export function TimeFieldDemo() {
  const [cycle, setCycle] = useState<HourCycle>(12);
  const [hours, setHours] = useState<Readonly<Record<string, Hours>>>(() => Object.fromEntries(days.map((d) => [d, { on: d !== 'Saturday', start: '09:00', end: '17:00' }])));
  const set = (d: string, patch: Partial<Hours>) => setHours((h) => ({ ...h, [d]: { ...(h[d] ?? { on: true, start: '09:00', end: '17:00' }), ...patch } }));
  const first = hours.Monday;
  return (
    <div className="tf-demo" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 'var(--space-32)' }}>
      <div className="tf-stack" style={{ gap: 'var(--space-8)' }}>
        <p className="tf-demo-label">Working hours · {first ? `Mon ${formatTime(first.start, cycle)} – ${formatTime(first.end, cycle)}` : ''}</p>
        {days.map((d) => {
          const h = hours[d];
          if (!h) return null;
          return (
            <div key={d} className="tf-row" style={{ flexWrap: 'nowrap', minHeight: 'var(--size-control)' }}>
              <span style={{ width: 'calc(var(--size-control) * 2.5)' }}><Switch isSelected={h.on} onChange={(on) => set(d, { on })}>{d.slice(0, 3)}</Switch></span>
              {h.on ? (
                <>
                  <TimeSelect label={`${d} start`} isLabelHidden hourCycle={cycle} value={h.start} onChange={(v) => v && set(d, { start: v })} />
                  <span className="tf-faint">–</span>
                  <TimeSelect label={`${d} end`} isLabelHidden hourCycle={cycle} value={h.end} from={toMin(h.start) + 15} onChange={(v) => v && set(d, { end: v })} />
                </>
              ) : <span className="tf-faint" style={{ fontSize: 13 }}>Unavailable</span>}
            </div>
          );
        })}
      </div>
      <div className="tf-stack" style={{ gap: 'var(--space-20)' }}>
        <Switch isSelected={cycle === 24} onChange={(v) => setCycle(v ? 24 : 12)}>24-hour clock</Switch>
        <TimeField label="Reminder at" hourCycle={cycle} defaultValue={new Time(8, 30)} />
        <TimeField label="Cut-off time" hourCycle={cycle} description="No bookings after this time." />
        <TimeField label="Ends" hourCycle={cycle} defaultValue={new Time(7, 0)} isInvalid errorMessage="End after the start (9:00)." />
      </div>
    </div>
  );
}
