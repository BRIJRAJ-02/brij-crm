import { useState } from 'react';
import { BarChart, BarList, ChartCard, DonutChart, PeriodSwitch, Sparkline, Stat, type ChartPoint, type DonutSegment } from './Chart.tsx';
import { Button } from '../Button/Button.tsx';

type Period = 'week' | 'month' | 'quarter';
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKS = ['W1', 'W2', 'W3', 'W4', 'W5'];
const MONTHS = ['Sep', 'Oct', 'Nov'];

const data: Readonly<Record<Period, {
  bookings: string; bookingsDelta: string; noShow: string; noShowDelta: string; revenue: string; revenueDelta: string;
  bars: ReadonlyArray<ChartPoint>; spark: ReadonlyArray<number>; types: ReadonlyArray<number>; pages: ReadonlyArray<number>;
}>> = {
  week: { bookings: '86', bookingsDelta: '+12 vs last week', noShow: '4.6%', noShowDelta: '−0.8 pts', revenue: '$3,240', revenueDelta: '+$410 vs last week',
    bars: DAYS.map((d, i) => ({ id: d, label: d, value: [14, 18, 16, 21, 12, 3, 2][i] ?? 0 })), spark: [9, 11, 10, 14, 13, 16, 18], types: [34, 22, 18, 12], pages: [41, 27, 18] },
  month: { bookings: '342', bookingsDelta: '+48 vs October', noShow: '5.1%', noShowDelta: '+0.3 pts', revenue: '$12,880', revenueDelta: '+$1,920 vs October',
    bars: WEEKS.map((w, i) => ({ id: w, label: w, value: [68, 74, 81, 77, 42][i] ?? 0 })), spark: [52, 61, 58, 66, 70, 68, 74], types: [128, 96, 70, 48], pages: [160, 112, 70] },
  quarter: { bookings: '1,018', bookingsDelta: '+131 vs Q2', noShow: '5.4%', noShowDelta: '−0.2 pts', revenue: '$38,400', revenueDelta: '+$5,100 vs Q2',
    bars: MONTHS.map((m, i) => ({ id: m, label: m, value: [296, 380, 342][i] ?? 0 })), spark: [180, 240, 220, 300, 290, 340, 380], types: [360, 310, 210, 138], pages: [470, 330, 218] },
};
const TYPES: ReadonlyArray<Omit<DonutSegment, 'value'>> = [
  { id: 'disc', label: 'Discovery call', hue: 'blue' }, { id: 'demo', label: 'Demo', hue: 'purple' },
  { id: 'onb', label: 'Onboarding', hue: 'orange' }, { id: 'check', label: 'Check-in', hue: 'green' },
];
const PAGES = ['Sales demo', 'Support hour', 'Partner intro'];

export function ChartDemo() {
  const [period, setPeriod] = useState<Period>('week');
  const [loading, setLoading] = useState(false);
  const d = loading ? undefined : data[period];
  const segs = d ? TYPES.map((t, i) => ({ ...t, value: d.types[i] ?? 0 })) : undefined;
  const sum = segs?.reduce((a, s) => a + s.value, 0);
  return (
    <div className="tf-demo tf-demo--canvas tf-stack">
      <div className="tf-row" style={{ justifyContent: 'space-between' }}>
        <PeriodSwitch label="Period" value={period} onChange={(p) => setPeriod(p === 'month' || p === 'quarter' ? p : 'week')}
          options={[{ id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }, { id: 'quarter', label: 'Quarter' }]} />
        <Button size="sm" variant="ghost" onPress={() => { setLoading(true); window.setTimeout(() => setLoading(false), 1600); }}>Show loading</Button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 'var(--space-12)' }}>
        <ChartCard title="Bookings"><Stat label="Booked meetings" value={d?.bookings} delta={d?.bookingsDelta} trend="up"><Sparkline label="Bookings trend" values={d?.spark} /></Stat></ChartCard>
        <ChartCard title="No-shows"><Stat label="Share of bookings" value={d?.noShow} delta={d?.noShowDelta} /></ChartCard>
        <ChartCard title="Revenue"><Stat label="Paid bookings" value={d?.revenue} delta={d?.revenueDelta} trend="up" /></ChartCard>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)', gap: 'var(--space-12)' }}>
        <ChartCard title="Bookings over time"><BarChart label="Bookings over time" points={d?.bars} /></ChartCard>
        <ChartCard title="By meeting type"><DonutChart label="Bookings by meeting type" segments={segs} total={sum?.toLocaleString('en-US')} totalLabel="Meetings" size={128} /></ChartCard>
      </div>
      <ChartCard title="By booking page">
        <BarList label="Bookings by booking page" items={d ? PAGES.map((p, i) => ({ id: p, label: p, value: d.pages[i] ?? 0 })) : undefined} />
      </ChartCard>
    </div>
  );
}
