import { useState } from 'react';
import { CalendarDays, Link2 } from 'lucide-react';
import { Button } from '../Button/Button.tsx';
import { EmptyState, NoResults } from './EmptyState.tsx';

const companies = ['Acme Corp', 'Northwind', 'Globex', 'Initech'];
const box = { borderRadius: 'var(--radius-lg)', background: 'var(--surface)', border: '1px solid var(--border-subtle)', minHeight: 250, display: 'grid', alignContent: 'center' } as const;

export function EmptyStateDemo() {
  const [run, setRun] = useState(0);
  const [query, setQuery] = useState('Umbrella');
  const shown = companies.filter((c) => c.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="tf-demo tf-demo--canvas" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 'var(--space-16)' }}>
      <div style={box}>
        <EmptyState key={run} icon={<CalendarDays size={20} strokeWidth={1.75} />} title="No bookings yet"
          description="When someone books Discovery call, it shows up here with their answers."
          action={<Button variant="primary" icon={<Link2 size={16} strokeWidth={1.75} />} onPress={() => setRun((r) => r + 1)}>Copy booking link</Button>} />
      </div>
      <div style={{ ...box, alignContent: 'start', padding: 'var(--space-12)' }}>
        <input aria-label="Search companies" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search companies"
          style={{ height: 'var(--size-control-sm)', padding: '0 var(--space-12)', borderRadius: 'var(--radius-full)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', font: 'inherit', fontSize: 13 }} />
        {shown.length === 0
          ? <NoResults size="sm" query={query} noun="companies" onClearFilters={() => setQuery('')} />
          : <ul style={{ listStyle: 'none', margin: 'var(--space-8) 0 0', padding: 0 }}>{shown.map((c) => <li key={c} style={{ height: 'var(--size-row)', display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)' }}>{c}</li>)}</ul>}
      </div>
    </div>
  );
}
