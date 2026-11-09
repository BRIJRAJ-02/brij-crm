import { useState } from 'react';
import { getLocalTimeZone, today as todayIn, type CalendarDate } from '@internationalized/date';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { BusinessPage, type ServiceCategory } from './BusinessPage.tsx';

const cover = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 1200 400">
<rect width="1200" height="400" fill="#e9e1d6"/><rect x="0" y="280" width="1200" height="120" fill="#c9b8a3"/>
<rect x="140" y="90" width="220" height="190" rx="8" fill="#f6f1ea"/><rect x="460" y="60" width="300" height="220" rx="8" fill="#f6f1ea"/>
<circle cx="900" cy="170" r="70" fill="#8a9a7b"/><rect x="890" y="230" width="20" height="60" fill="#6d5c4b"/><rect x="560" y="300" width="100" height="40" rx="6" fill="#7b5e47"/></svg>`)}`;

const categories: ServiceCategory[] = [
  { id: 'cuts', name: 'Haircuts', services: [
    { id: 'cut', name: 'Cut and finish', minutes: 45, price: '£48', description: 'A consultation, wash, cut and blow dry with one of our stylists.' },
    { id: 'trim', name: 'Fringe trim', minutes: 15, price: '£12' },
    { id: 'mens', name: 'Short cut', minutes: 30, price: '£32', description: 'Clipper and scissor work, finished with a wash.' },
  ] },
  { id: 'colour', name: 'Colour', services: [
    { id: 'roots', name: 'Root colour', minutes: 75, price: 'from £65' },
    { id: 'balayage', name: 'Balayage', minutes: 180, price: 'from £140', description: 'Hand painted lightening for a soft, grown out look. A patch test is needed 48 hours before.' },
    { id: 'gloss', name: 'Gloss and tone', minutes: 45, price: '£40' },
  ] },
  { id: 'care', name: 'Treatments', services: [
    { id: 'mask', name: 'Repair mask', minutes: 20, price: '£18' },
    { id: 'scalp', name: 'Scalp massage', minutes: 30, price: '£25' },
  ] },
];
const staff = [{ id: 'maria', name: 'Maria Bell', role: 'Senior stylist' }, { id: 'jo', name: 'Jo Mendes', role: 'Colour specialist' }, { id: 'ava', name: 'Ava Chen', role: 'Stylist' }];

const seed = (d: CalendarDate) => d.year * 400 + d.month * 31 + d.day;
const weekday = (d: CalendarDate) => new Date(d.year, d.month - 1, d.day).getDay();
const booking = {
  today: todayIn(getLocalTimeZone()),
  isDayOpen: (d: CalendarDate) => weekday(d) !== 0 && seed(d) % 5 !== 0,
  slotsFor: (d: CalendarDate) => { const out: number[] = []; for (let m = 10 * 60; m <= 18 * 60; m += 30) if ((seed(d) + m / 30) % 4 !== 0) out.push(m); return out; },
  timeZones: [{ id: 'Europe/London', label: 'London (GMT)' }],
  defaultTimeZone: 'Europe/London',
  onBook: () => new Promise<void>((resolve) => { window.setTimeout(resolve, 900); }),
};

export function BusinessPageDemo() {
  const [kind, setKind] = useState('salon');
  return (
    <div className="tf-demo tf-demo--canvas tf-stack">
      <SegmentedControl aria-label="Business" selectedKey={kind} onSelectionChange={setKind} size="sm"
        items={[{ id: 'salon', label: 'Salon' }, { id: 'restaurant', label: 'Restaurant' }]} />
      <div className="tf-bizdemo__scroll" tabIndex={0} aria-label="Business page preview" role="region">
        {kind === 'salon' ? (
          <BusinessPage key="salon" mode="services" categories={categories} staff={staff} booking={booking}
            business={{ name: 'Northwind Hair', kind: 'Hair salon', rating: 4.9, reviews: 312, address: '14 Market St, London E1 6AB', phone: '020 7946 0000', coverSrc: cover, opensAt: 9 * 60, closesAt: 19 * 60, now: 14 * 60 + 20 }} />
        ) : (
          <BusinessPage key="restaurant" mode="table" partyMax={8} booking={booking}
            business={{ name: 'Globex Bistro', kind: 'Neighbourhood bistro', rating: 4.7, reviews: 1204, address: '2 Canal Row, London N1 9GU', phone: '020 7946 0123', opensAt: 17 * 60, closesAt: 23 * 60, now: 14 * 60 + 20 }} />
        )}
      </div>
    </div>
  );
}
