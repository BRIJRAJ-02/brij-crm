import { useCallback, useState } from 'react';
import { X } from 'lucide-react';
import { ReferencePicker, type RecordRef } from './ComboBox.tsx';
import { PersonLine } from '../Avatar/Avatar.tsx';
import { IconButton } from '../Button/Button.tsx';

const records: ReadonlyArray<RecordRef> = [
  { id: 'p1', name: 'Priya Raman', kind: 'person', sub: 'Acme Corp · priya@acme.com' },
  { id: 'p2', name: 'Sam Kim', kind: 'person', sub: 'Northwind · sam@northwind.io' },
  { id: 'p3', name: 'Jo Mendes', kind: 'person', sub: 'Globex · jo@globex.com' },
  { id: 'p4', name: 'Ava Chen', kind: 'person', sub: 'Initech · ava@initech.com' },
  { id: 'p5', name: 'Maria Bell', kind: 'person', sub: 'Acme Corp · maria@acme.com' },
  { id: 'c1', name: 'Acme Corp', kind: 'company', sub: 'acme.com' },
  { id: 'c2', name: 'Northwind', kind: 'company', sub: 'northwind.io' },
  { id: 'c3', name: 'Globex', kind: 'company', sub: 'globex.com' },
  { id: 'c4', name: 'Initech', kind: 'company', sub: 'initech.com' },
];

export function ComboBoxDemo() {
  const [linked, setLinked] = useState<ReadonlyArray<RecordRef>>([records[0], records[5]].filter((r): r is RecordRef => r !== undefined));
  const search = useCallback((q: string) => new Promise<ReadonlyArray<RecordRef>>((done) => {
    window.setTimeout(() => done(records.filter((r) => `${r.name} ${r.sub ?? ''}`.toLowerCase().includes(q.toLowerCase()))), 700);
  }), []);
  const add = (r: RecordRef) => setLinked((l) => (l.some((x) => x.id === r.id) ? l : [...l, r]));
  return (
    <div className="tf-demo" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 320px) minmax(0, 1fr)', gap: 'var(--space-32)' }}>
      <ReferencePicker
        label="Link a record" recent={records.slice(1, 4)} search={search} onSelect={add}
        onCreate={(name) => add({ id: `new-${name}`, name, kind: 'company', sub: 'New company' })}
        description="Try “glo”, then “acme labs”."
      />
      <div className="tf-stack" style={{ gap: 'var(--space-4)' }}>
        <p className="tf-demo-label">Linked to Discovery call</p>
        {linked.map((r) => (
          <div key={r.id} className="tf-row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
            <PersonLine name={r.name} sub={r.sub} shape={r.kind === 'company' ? 'square' : 'round'} />
            <IconButton size="sm" label={`Unlink ${r.name}`} onPress={() => setLinked((l) => l.filter((x) => x.id !== r.id))}><X size={14} strokeWidth={1.75} /></IconButton>
          </div>
        ))}
      </div>
    </div>
  );
}
