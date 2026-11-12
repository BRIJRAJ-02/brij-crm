import { RecordChip, LinkChip, Mention, Variable, RecordChipList } from './RecordChip.tsx';

const recent = [
  { id: 'acme', name: 'Acme Corp', kind: 'company' as const, href: '#acme' },
  { id: 'priya', name: 'Priya Raman', href: '#priya' },
  { id: 'northwind', name: 'Northwind', kind: 'company' as const, href: '#northwind' },
  { id: 'sam', name: 'Sam Kim', href: '#sam' },
  { id: 'globex', name: 'Globex', kind: 'company' as const, href: '#globex' },
  { id: 'jo', name: 'Jo Mendes', href: '#jo' },
  { id: 'initech', name: 'Initech', kind: 'company' as const, href: '#initech' },
];

export function RecordChipDemo() {
  return (
    <div className="tf-demo" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-24)' }}>
      <div className="tf-stack">
        <p className="tf-demo-label">Record chips and links</p>
        <div className="tf-row">
          <RecordChip name="Priya Raman" href="#priya" />
          <RecordChip name="Acme Corp" kind="company" href="#acme" />
          <RecordChip name="Maria Bell" />
          <LinkChip href="https://www.northwind.com/" />
        </div>
        <p className="tf-demo-label" style={{ marginTop: 'var(--space-8)' }}>Recently viewed · hover the row</p>
        <RecordChipList label="Recently viewed" records={recent} max={5} />
      </div>
      <div className="tf-stack">
        <p className="tf-demo-label">In text</p>
        <p style={{ margin: 0 }}>
          <Mention name="Sam Kim" href="#sam" /> can you take the demo with Northwind on Monday? <Mention name="Priya Raman" isSelf /> is out.
        </p>
        <p className="tf-demo-label" style={{ marginTop: 'var(--space-8)' }}>Email template</p>
        <p style={{ margin: 0 }}>
          Hi <Variable name="first name" />, thanks for booking a <Variable name="meeting type" /> with <Variable name="company" isMissing />. See you on <Variable name="start time" />.
        </p>
      </div>
    </div>
  );
}
