import { useState } from 'react';
import { Zap } from 'lucide-react';
import { ActivityFeed, type ActivityEvent } from './ActivityFeed.tsx';
import { Button } from '../Button/Button.tsx';
import { STAGES, DEMO_PEOPLE } from '../AttributeField/AttributeField.demo.tsx';
import type { Attribute } from '../AttributeField/AttributeField.tsx';

const value: Attribute = { id: 'value', name: 'Deal value', type: 'currency', currency: 'USD' };
const owner: Attribute = { id: 'owner', name: 'Owner', type: 'actor' };
const close: Attribute = { id: 'close', name: 'Close date', type: 'date' };

/** A moment `daysAgo` days before today at hh:mm, so the demo always reads Today and Yesterday. */
function at(daysAgo: number, hh: number, mm: number): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysAgo, hh, mm);
}

const start: ReadonlyArray<ActivityEvent> = [
  { id: 'e1', at: at(0, 14, 5), actor: 'Sam Kim', kind: 'change', changes: [{ attribute: STAGES, from: 'lead', to: 'qualified' }] },
  { id: 'e2', at: at(0, 11, 30), actor: 'Priya Raman', kind: 'comment', body: 'They want a pilot in the Leeds depot first. Can we send pricing for one site?' },
  { id: 'e3', at: at(0, 9, 12), actor: 'Sam Kim', kind: 'booked', meeting: 'Demo · 45 min', when: at(-3, 14, 0) },
  { id: 'e4', at: at(1, 16, 40), actor: 'Jo Mendes', kind: 'change', changes: [
    { attribute: value, from: 30000, to: 48000 }, { attribute: owner, from: DEMO_PEOPLE[0], to: DEMO_PEOPLE[1] }, { attribute: close, from: '2026-11-28', to: '2026-12-12' },
  ] },
  { id: 'e5', at: at(1, 10, 2), actor: 'Priya Raman', kind: 'emailed', subject: 'Follow-up: pricing for one depot', preview: 'Hi Maria, as promised here is the pilot pricing for one site, plus the security pack your IT team asked for.' },
];
const older: ReadonlyArray<ActivityEvent> = [
  { id: 'o1', at: at(7, 15, 20), actor: 'Ava Chen', kind: 'note', title: 'Discovery call recap' },
  { id: 'o2', at: at(7, 15, 10), actor: 'Ava Chen', kind: 'cancelled', meeting: 'Discovery call · 30 min', when: at(3, 10, 30) },
  { id: 'o3', at: at(26, 9, 0), actor: 'Sam Kim', kind: 'created', object: 'company' },
];
const next = ['proposal', 'won', 'lost', 'lead', 'qualified'];

export function ActivityFeedDemo() {
  const [events, setEvents] = useState(start);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [n, setN] = useState(0);
  const simulate = () => {
    const prev = events.find((e): e is Extract<ActivityEvent, { kind: 'change' }> => e.kind === 'change' && e.changes[0]?.attribute.id === 'stage');
    const from = prev?.changes[0]?.to;
    const to = next[n % next.length];
    const id = `live-${n}`;
    setEvents((list) => [{ id, at: new Date(), actor: 'Maria Bell', kind: 'change', changes: [{ attribute: STAGES, from, to }] }, ...list]);
    setFresh((s) => new Set(s).add(id));
    setN((x) => x + 1);
  };
  return (
    <div className="tf-demo">
      <div className="tf-feed-demo">
        <div className="tf-feed-demo__bar">
          <span className="tf-demo-label" style={{ margin: 0 }}>Acme Corp · Activity</span>
          <Button size="sm" variant="secondary" icon={<Zap size={14} strokeWidth={1.75} />} onPress={simulate}>Simulate a live change</Button>
        </div>
        <ActivityFeed events={events} older={older} freshIds={fresh} />
      </div>
    </div>
  );
}
