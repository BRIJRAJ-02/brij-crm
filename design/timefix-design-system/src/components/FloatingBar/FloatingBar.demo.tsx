import { useState } from 'react';
import { Archive, Mail, Trash2 } from 'lucide-react';
import { Checkbox } from '../Checkbox/Checkbox.tsx';
import { BarButton, BulkActionBar, PublishBar, SaveBar, type PublishBarStatus, type SaveBarStatus } from './FloatingBar.tsx';

const people = ['Priya Raman', 'Sam Kim', 'Jo Mendes', 'Ava Chen'];
const i = { size: 16, strokeWidth: 1.75 } as const;
const region = { position: 'relative', height: 236, overflow: 'hidden', borderRadius: 'var(--radius-lg)', background: 'var(--surface)', border: '1px solid var(--border-subtle)', padding: 'var(--space-16)' } as const;

export function FloatingBarDemo() {
  const [sel, setSel] = useState<ReadonlySet<string>>(new Set(['Sam Kim', 'Jo Mendes', 'Ava Chen']));
  const [title, setTitle] = useState('Discovery call');
  const [saved, setSaved] = useState('Discovery call');
  const [save, setSave] = useState<SaveBarStatus>('hidden');
  const [pub, setPub] = useState<PublishBarStatus>('draft');
  const [changes, setChanges] = useState(2);
  const onSave = () => {
    setSave('saving');
    window.setTimeout(() => setSave('saved'), 700);
    window.setTimeout(() => { setSave('hidden'); setSaved(title); setChanges((c) => c + 1); setPub('draft'); }, 1900);
  };
  const onPublish = () => { setPub('publishing'); window.setTimeout(() => setPub('published'), 800); window.setTimeout(() => { setPub('live'); setChanges(0); }, 2200); };
  return (
    <div className="tf-demo tf-demo--canvas" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--space-16)' }}>
      <div style={region}>
        <p className="tf-demo-label">Bulk actions: select rows</p>
        <div className="tf-stack" style={{ gap: 'var(--space-8)' }}>
          {people.map((p) => (
            <Checkbox key={p} isSelected={sel.has(p)} onChange={(v) => setSel((s) => { const n = new Set(s); if (v) n.add(p); else n.delete(p); return n; })}>{p}</Checkbox>
          ))}
        </div>
        <BulkActionBar count={sel.size} onClear={() => setSel(new Set())}>
          <BarButton icon={<Mail {...i} />}>Email</BarButton>
          <BarButton icon={<Archive {...i} />}>Archive</BarButton>
          <BarButton icon={<Trash2 {...i} />} onPress={() => setSel(new Set())}>Delete</BarButton>
        </BulkActionBar>
      </div>
      <div style={region}>
        <p className="tf-demo-label">Save, then publish: edit the name</p>
        <label className="tf-stack" style={{ gap: 'var(--space-6)', fontSize: 13, fontWeight: 500 }}>
          Booking page name
          <input value={title} onChange={(e) => { setTitle(e.target.value); setSave(e.target.value === saved ? 'hidden' : 'unsaved'); }}
            style={{ height: 'var(--size-control)', padding: '0 var(--space-12)', border: 0, borderRadius: 'var(--radius-md)', background: 'var(--surface-subtle)', font: 'inherit', fontWeight: 400, color: 'var(--text)' }} />
        </label>
        <SaveBar status={save} onSave={onSave} onDiscard={() => { setTitle(saved); setSave('hidden'); }} />
        <PublishBar status={save === 'hidden' ? pub : 'live'} changes={changes} onPublish={onPublish} onPreview={() => undefined} />
      </div>
    </div>
  );
}
