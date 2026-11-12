import { useState } from 'react';
import { SearchField } from './SearchField.tsx';

const people = [
  { name: 'Priya Raman', org: 'Acme Corp' },
  { name: 'Sam Kim', org: 'Northwind' },
  { name: 'Jo Mendes', org: 'Globex' },
  { name: 'Ava Chen', org: 'Initech' },
  { name: 'Maria Bell', org: 'Acme Corp' },
];

export function SearchFieldDemo() {
  const [q, setQ] = useState('Acme Corp');
  const hits = people.filter((p) => `${p.name} ${p.org}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="tf-demo" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 'var(--space-32)' }}>
      <div className="tf-stack">
        <p className="tf-demo-label" style={{ margin: 0 }}>Filter a list · press the × or Esc</p>
        <SearchField label="Filter people" placeholder="Filter people" value={q} onChange={setQ} />
        <div className="tf-stack" style={{ gap: 'var(--space-4)', fontSize: 13 }}>
          {hits.map((p) => (
            <span key={p.name}><span style={{ fontWeight: 500 }}>{p.name}</span> <span className="tf-muted">· {p.org}</span></span>
          ))}
          {hits.length === 0 && <span className="tf-muted">No one matches “{q}”.</span>}
        </div>
      </div>
      <div className="tf-stack">
        <p className="tf-demo-label" style={{ margin: 0 }}>Command search · press ⌘K</p>
        <SearchField label="Search Timefix" placeholder="Search people, pages, forms" shortcut="⌘K" />
        <p className="tf-demo-label" style={{ margin: 'var(--space-8) 0 0' }}>Toolbar, 28px</p>
        <div className="tf-row">
          <SearchField size="sm" label="Search bookings" placeholder="Search bookings" defaultValue="Discovery call" style={{ width: 220 }} />
          <SearchField size="sm" label="Search forms" placeholder="Search forms" isDisabled style={{ width: 160 }} />
        </div>
      </div>
    </div>
  );
}
