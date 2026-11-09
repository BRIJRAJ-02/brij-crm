import { useState } from 'react';
import { Board, moveCards, type BoardColumn } from './Board.tsx';

/** Today moved by `days`. */
const day = (days: number) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days); };

const seed: ReadonlyArray<BoardColumn> = [
  { id: 'lead', title: 'Lead', status: 'draft', cards: [
    { id: 'globex', title: 'Globex', description: 'Inbound from the pricing page. Wants round robin for a team of eight.', tags: [{ label: 'SMB', hue: 'sky' }], people: ['Jo Mendes'], date: day(3) },
    { id: 'hooli', title: 'Hooli', description: 'Asked about booking pages in German and French.', tags: [{ label: 'Mid-market', hue: 'purple' }], people: ['Ava Chen', 'Sam Kim'] },
  ] },
  { id: 'qualified', title: 'Qualified', status: 'progress', cards: [
    { id: 'acme', title: 'Acme Corp', description: 'Discovery call went well. Needs Salesforce sync and routing forms before a pilot.', tags: [{ label: 'Mid-market', hue: 'purple' }, { label: 'Pilot', hue: 'green' }], people: ['Priya Raman', 'Sam Kim', 'Maria Bell'], date: day(1) },
  ] },
  { id: 'demo', title: 'Demo booked', status: 'review', cards: [
    { id: 'northwind', title: 'Northwind', description: 'Demo 45 min with their ops lead. Send the security pack first.', tags: [{ label: 'Enterprise', hue: 'orange' }], people: ['Sam Kim'], date: day(0) },
    { id: 'initech', title: 'Initech', description: 'Comparing us with Calendly for 52 seats.', tags: [{ label: 'Mid-market', hue: 'purple' }], people: ['Ava Chen'], date: day(5) },
  ] },
  { id: 'won', title: 'Won', status: 'done', cards: [] },
  { id: 'lost', title: 'Lost', status: 'failed', isCollapsed: true, cards: [
    { id: 'umbrella', title: 'Umbrella Health', description: 'Went with an in-house tool.', people: ['Maria Bell'] },
  ] },
];

export function BoardDemo() {
  const [columns, setColumns] = useState(seed);
  return (
    <div className="tf-demo tf-demo--canvas tf-stack">
      <p className="tf-faint" style={{ margin: 0, fontSize: 13 }}>
        Drag a card between columns, or focus its grip and press Enter, the arrows, then Enter. Fold a column with its chevron.
      </p>
      <Board
        label="Deals by stage"
        noun="deals"
        columns={columns}
        onMove={(m) => setColumns((cs) => moveCards(cs, m))}
        onAdd={(id) => {
          setColumns((cs) => cs.map((c) => (c.id === id ? { ...c, cards: [{ id: `new-${Date.now()}`, title: 'Untitled deal', description: 'Add a company and an owner.', people: ['Priya Raman'] }, ...c.cards] } : c)));
        }}
        onToggleCollapse={(id) => setColumns((cs) => cs.map((c) => (c.id === id ? { ...c, isCollapsed: !c.isCollapsed } : c)))}
      />
    </div>
  );
}
