import { useState } from 'react';
import { Button } from '../Button/Button.tsx';
import { DonutChart, type DonutSegment } from '../Chart/Chart.tsx';
import { Meter, ProgressBar } from './Progress.tsx';

const months: Record<'this' | 'last', { readonly used: string; readonly segments: readonly DonutSegment[] }> = {
  this: { used: '72%', segments: [
    { id: 'pages', label: 'Booking pages', value: 412, hue: 'blue' }, { id: 'forms', label: 'Forms', value: 208, hue: 'purple' },
    { id: 'links', label: 'Link pages', value: 100, hue: 'orange' }, { id: 'left', label: 'Remaining', value: 280, hue: 'track' },
  ] },
  last: { used: '54%', segments: [
    { id: 'pages', label: 'Booking pages', value: 296, hue: 'blue' }, { id: 'forms', label: 'Forms', value: 164, hue: 'purple' },
    { id: 'links', label: 'Link pages', value: 80, hue: 'orange' }, { id: 'left', label: 'Remaining', value: 460, hue: 'track' },
  ] },
};

export function ProgressDemo() {
  const [upload, setUpload] = useState(64);
  const [month, setMonth] = useState<'this' | 'last'>('this');
  const data = months[month];
  return (
    <div className="tf-demo" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 'var(--space-32)' }}>
      <div className="tf-stack" style={{ gap: 'var(--space-20)' }}>
        <div className="tf-stack" style={{ gap: 'var(--space-8)' }}>
          <ProgressBar label="Importing contacts.csv" value={upload} showValue />
          <div className="tf-row">
            <Button size="sm" onPress={() => setUpload((v) => (v >= 100 ? 12 : Math.min(100, v + 22)))}>{upload >= 100 ? 'Start again' : 'Advance'}</Button>
            <span className="tf-faint" style={{ fontSize: 13 }}>{upload >= 100 ? '1,284 contacts imported' : 'Row 822 of 1,284'}</span>
          </div>
        </div>
        <ProgressBar label="Syncing Google Calendar" isIndeterminate />
        <Meter label="Bookings this month" value={820} maxValue={1000} valueLabel="820 of 1,000" hint="Upgrade before you reach the limit to keep pages open." />
        <Meter label="Seats" value={5} maxValue={5} valueLabel="5 of 5" hint="Every seat is taken. Free one or add seats to invite more people." />
        <Meter label="File storage" value={2.1} maxValue={10} valueLabel="2.1 of 10 GB" />
      </div>
      <div className="tf-stack">
        <div className="tf-row" style={{ justifyContent: 'space-between' }}>
          <p className="tf-demo-label" style={{ margin: 0 }}>Plan usage, responses</p>
          <div className="tf-row" style={{ gap: 'var(--space-4)' }}>
            <Button size="sm" variant={month === 'this' ? 'soft' : 'ghost'} onPress={() => setMonth('this')}>This month</Button>
            <Button size="sm" variant={month === 'last' ? 'soft' : 'ghost'} onPress={() => setMonth('last')}>Last month</Button>
          </div>
        </div>
        <DonutChart label={month === 'this' ? 'Plan usage this month' : 'Plan usage last month'} total={data.used} totalLabel="of 1,000 used" segments={data.segments} />
      </div>
    </div>
  );
}
