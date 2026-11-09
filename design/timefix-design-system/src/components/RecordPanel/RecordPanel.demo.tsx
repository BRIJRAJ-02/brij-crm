import { useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { CalendarClock } from 'lucide-react';
import { RecordPanel, AttributeRow, RecordSection } from './RecordPanel.tsx';
import { Avatar, AvatarGroup, PersonLine } from '../Avatar/Avatar.tsx';
import type { Attribute, AttributeValue } from '../AttributeField/AttributeField.tsx';
import { RecordChip } from '../RecordChip/RecordChip.tsx';
import { NoteCard } from '../NoteList/NoteList.tsx';
import { STAGES, DEMO_PEOPLE } from '../AttributeField/AttributeField.demo.tsx';
import { formatClockRange } from '../WeekCalendar/clock.ts';
import { formatDay } from '../../lib/format.ts';

/** The demo's next meeting: Thursday 13 November, 2:00 – 2:45 PM. */
const DEMO_WHEN = `${formatDay(new Date(2026, 10, 13))}, ${formatClockRange(14 * 60, 14 * 60 + 45)}`;

const attrs: ReadonlyArray<Attribute> = [
  { id: 'domain', name: 'Domain', type: 'domain' },
  { id: 'industry', name: 'Industry', type: 'select', options: [{ id: 'log', label: 'Logistics', hue: 'sky' }, { id: 'food', label: 'Food', hue: 'lime' }, { id: 'energy', label: 'Energy', hue: 'orange' }, { id: 'pay', label: 'Payments', hue: 'purple' }] },
  STAGES,
  { id: 'owner', name: 'Owner', type: 'actor', candidates: DEMO_PEOPLE },
  { id: 'size', name: 'Employees', type: 'number' },
  { id: 'value', name: 'Deal value', type: 'currency', currency: 'USD' },
  { id: 'renewal', name: 'Renewal', type: 'date' },
];
const records = [
  { id: 'acme', name: 'Acme Corp', sub: 'London · Customer since 2024', people: ['Priya Raman', 'Jo Mendes'], values: { domain: 'acme.com', industry: 'log', stage: 'qualified', owner: DEMO_PEOPLE[1], size: 1240, value: 48000, renewal: '2026-12-01' } },
  { id: 'north', name: 'Northwind', sub: 'Seattle · Trial', people: ['Ava Chen'], values: { domain: 'northwind.com', industry: 'food', stage: 'lead', owner: DEMO_PEOPLE[0], size: 310, value: 12000, renewal: undefined } },
  { id: 'globex', name: 'Globex', sub: 'Springfield · Prospect', people: ['Maria Bell', 'Sam Kim', 'Jo Mendes'], values: { domain: 'globex.com', industry: 'energy', stage: 'proposal', owner: DEMO_PEOPLE[3], size: 8400, value: 120000, renewal: '2027-03-15' } },
  { id: 'initech', name: 'Initech', sub: 'Austin · Churned', people: [], values: { domain: 'initech.io', industry: 'pay', stage: 'lost', owner: DEMO_PEOPLE[4], size: 95, value: undefined, renewal: undefined } },
] as const;

export function RecordPanelDemo() {
  const [open, setOpen] = useState(true);
  const [at, setAt] = useState(0);
  const [values, setValues] = useState<Readonly<Record<string, Readonly<Record<string, AttributeValue>>>>>(() => Object.fromEntries(records.map((r) => [r.id, r.values])));
  const r = records[at] ?? records[0];
  const set = (attr: string) => (v: AttributeValue) => setValues((s) => ({ ...s, [r.id]: { ...s[r.id], [attr]: v } }));
  return (
    <div className="tf-demo tf-demo--canvas">
      <div className="tf-rpanel-demo">
        <nav className="tf-rpanel-demo__list" aria-label="Companies">
          {records.map((x, i) => (
            <AriaButton key={x.id} className="tf-rpanel-demo__row" aria-current={open && i === at} onPress={() => { setAt(i); setOpen(true); }}>
              <PersonLine name={x.name} shape="square" sub={x.sub} />
            </AriaButton>
          ))}
        </nav>
        <RecordPanel isOpen={open} onClose={() => setOpen(false)} objectName="Company" label={r.name} recordKey={r.id}
          position={{ index: at + 1, total: records.length, onPrevious: () => setAt((i) => Math.max(0, i - 1)), onNext: () => setAt((i) => Math.min(records.length - 1, i + 1)) }}
          onExpand={() => undefined}>
          <div className="tf-rpanel-demo__who">
            <Avatar name={r.name} shape="square" size={44} />
            <div><h2 className="tf-rpanel-demo__name">{r.name}</h2><p className="tf-rpanel-demo__sub">{r.sub}</p></div>
          </div>
          <div className="tf-rpanel-demo__attrs">
            {attrs.map((a) => <AttributeRow key={a.id} attribute={a} value={values[r.id]?.[a.id]} onChange={set(a.id)} />)}
          </div>
          <RecordSection title="Linked records" count={r.people.length} onAdd={() => undefined}>
            <div className="tf-rpanel-demo__chips">
              {r.people.length ? r.people.map((p) => <RecordChip key={p} name={p} kind="person" />) : <span className="tf-faint">No people linked yet</span>}
            </div>
          </RecordSection>
          <RecordSection title="Notes" count={2} onAdd={() => undefined}>
            <div className="tf-rpanel-demo__notes">
              <NoteCard note={{ id: 'n1', title: 'Discovery call recap', body: 'They dispatch 4,000 loads a week across three depots. Pain is double booking on Mondays; Priya wants a pilot in one depot first.', author: 'Sam Kim', updated: '2h ago' }} />
              <NoteCard note={{ id: 'n2', title: 'Security review', body: 'SOC 2 report sent. Waiting on their IT team for SSO details.', author: 'Priya Raman', updated: 'Mon' }} />
            </div>
          </RecordSection>
          <RecordSection title="Upcoming meetings" count={1}>
            <div className="tf-rpanel-demo__meeting">
              <span className="tf-rpanel-demo__mwell"><CalendarClock size={14} strokeWidth={1.75} /></span>
              <span className="tf-rpanel-demo__mtext"><span className="tf-rpanel-demo__mtitle">Demo · 45 min</span><span className="tf-rpanel-demo__mwhen">{DEMO_WHEN}</span></span>
              <AvatarGroup names={['Sam Kim', ...r.people]} size={20} max={3} />
            </div>
          </RecordSection>
        </RecordPanel>
      </div>
    </div>
  );
}
