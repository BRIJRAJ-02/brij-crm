import { useState } from 'react';
import { BookingPageCard, BookingPagePicture } from './BookingPagePicture.tsx';

const pages = [
  { id: 'discovery', host: 'Priya Raman', title: 'Discovery call', duration: '30 min', hue: 'blue', openDays: [true, true, true, true, true, false, false], location: { kind: 'video', label: 'Google Meet' }, url: 'https://timefix.com/priya/discovery' },
  { id: 'demo', host: 'Sam Kim', title: 'Product demo for new teams', duration: '45 min', hue: 'purple', openDays: [false, true, true, true, false, false, false], location: { kind: 'video', label: 'Zoom' }, url: 'https://timefix.com/sam/demo' },
  { id: 'clinic', host: 'Jo Mendes', title: 'Physio follow-up', duration: '30 or 60 min', hue: 'green', openDays: [true, true, true, true, true, true, false], location: { kind: 'place', label: 'Northwind Clinic, 4 Market St' }, url: 'https://timefix.com/jo/physio' },
] as const;

export function BookingPagePictureDemo() {
  const [on, setOn] = useState<Record<string, boolean>>({ discovery: true, demo: true, clinic: false });
  const [last, setLast] = useState('Nothing yet');
  return (
    <div className="tf-demo tf-demo--canvas tf-stack">
      <div className="tf-bpdemo__grid">
        {pages.map((p) => (
          <BookingPageCard key={p.id} {...p} openDays={[...p.openDays]} isOn={on[p.id] ?? false}
            onOnChange={(v) => setOn((s) => ({ ...s, [p.id]: v }))}
            onAction={(a) => setLast(`${a} · ${p.title}`)} />
        ))}
      </div>
      <div className="tf-row">
        <p className="tf-demo-label">Picture alone, no open days</p>
      </div>
      <div className="tf-bpdemo__alone">
        <BookingPagePicture host="Ava Chen" title="Office hours" duration="15 min" openDays={[false, false, false, false, false, false, false]} hue="orange" />
      </div>
      <p className="tf-demo-label">Last action: {last}</p>
    </div>
  );
}
