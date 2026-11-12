import { useState } from 'react';
import { HoursEditor, HoursSummary, type WeekHours } from './HoursEditor.tsx';

const nine = (id: string) => [{ id, start: 9 * 60, end: 17 * 60 }];
const start: WeekHours = {
  mon: { on: true, ranges: nine('m1') },
  tue: { on: true, ranges: [{ id: 't1', start: 9 * 60, end: 12 * 60 }, { id: 't2', start: 14 * 60, end: 18 * 60 }] },
  wed: { on: true, ranges: nine('w1') },
  thu: { on: true, ranges: [{ id: 'h1', start: 10 * 60, end: 13 * 60 }, { id: 'h2', start: 12 * 60, end: 16 * 60 }] },
  fri: { on: true, ranges: nine('f1') },
  sat: { on: false, ranges: [] },
  sun: { on: false, ranges: [] },
};

export function HoursEditorDemo() {
  const [week, setWeek] = useState<WeekHours>(start);
  return (
    <div className="tf-demo tf-stack" style={{ gap: 'var(--space-8)' }}>
      <div>
        <p style={{ margin: 0, font: '500 15px/22px var(--font-sans)' }}>Working hours</p>
        <HoursSummary value={week} />
      </div>
      <HoursEditor value={week} onChange={setWeek} />
    </div>
  );
}
