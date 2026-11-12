import { useState } from 'react';
import { CalendarCheck, UserCheck, Building2, Video, Phone, MapPin, Banknote } from 'lucide-react';
import { Card, CardLink, Shell, StatCard, TileGrid } from './Card.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { PersonLine } from '../Avatar/Avatar.tsx';
import { Tag } from '../Tag/Tag.tsx';

const i = { size: 16, strokeWidth: 1.75 } as const;
const DATA = {
  '7d': { bookings: 128, bDelta: '+12%', show: 92, sDelta: '+3 pts', companies: 24, cDelta: '−4', spark: [14, 18, 16, 21, 19, 24, 16] },
  '30d': { bookings: 1305, bDelta: '+8%', show: 89, sDelta: '−1 pt', companies: 96, cDelta: '+11', spark: [210, 260, 240, 300, 280, 330, 310, 355, 340, 390] },
} as const;

export function CardDemo() {
  const [period, setPeriod] = useState<'7d' | '30d'>('7d');
  const [where, setWhere] = useState('meet');
  const d = DATA[period];
  return (
    <div className="tf-demo tf-stack" style={{ gap: 'var(--space-20)' }}>
      <Shell title={period === '7d' ? 'This week' : 'Last 30 days'} columns={3} action={
        <SegmentedControl aria-label="Period" size="sm" selectedKey={period} onSelectionChange={(k) => setPeriod(k === '30d' ? '30d' : '7d')} items={[{ id: '7d', label: '7 days' }, { id: '30d', label: '30 days' }]} />
      }>
        <StatCard label="Bookings" icon={<CalendarCheck {...i} />} value={d.bookings} delta={{ value: d.bDelta, direction: 'up', note: 'vs prior period' }} sparkline={d.spark} />
        <StatCard label="Show rate" icon={<UserCheck {...i} />} value={d.show} format={(n) => `${n}%`} delta={{ value: d.sDelta, direction: period === '7d' ? 'up' : 'down', note: 'vs prior period' }} />
        <StatCard label="New companies" icon={<Building2 {...i} />} value={d.companies} delta={{ value: d.cDelta, direction: period === '7d' ? 'down' : 'up', note: 'vs prior period' }} />
      </Shell>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-16)', alignItems: 'start' }}>
        <StatCard label="Bookings by source" value={d.bookings} breakdown={[{ label: 'Booking page', share: 54, hue: 'blue' }, { label: 'Website embed', share: 28, hue: 'purple' }, { label: 'Link page', share: 18, hue: 'green' }]} />
        <StatCard label="Revenue booked" icon={<Banknote {...i} />} sparkline={[]} />
        <Card title="Up next" description="Today, 3 meetings" action={<CardLink>See all</CardLink>}>
          <div className="tf-stack" style={{ gap: 'var(--space-12)' }}>
            <PersonLine name="Priya Raman" sub="Discovery call 30 min · 10:00" end={<Tag size="sm" hue="blue">In 20 min</Tag>} />
            <PersonLine name="Sam Kim" sub="Demo 45 min · 13:30" />
            <PersonLine name="Jo Mendes" sub="Follow-up · 16:00" />
          </div>
        </Card>
      </div>
      <TileGrid label="Where do you meet?" value={where} onChange={setWhere} columns={4} items={[
        { id: 'meet', title: 'Google Meet', description: 'A link is added to each booking', icon: <Video {...i} /> },
        { id: 'phone', title: 'Phone call', description: 'You call the guest', icon: <Phone {...i} /> },
        { id: 'person', title: 'In person', description: 'At an address you set', icon: <MapPin {...i} /> },
        { id: 'zoom', title: 'Zoom', description: 'Connect Zoom first', icon: <Video {...i} />, isDisabled: true },
      ]} />
    </div>
  );
}
