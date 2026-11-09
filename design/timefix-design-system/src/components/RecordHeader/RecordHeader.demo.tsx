import { useState } from 'react';
import { Link2, Copy, Merge, Trash2 } from 'lucide-react';
import { RecordHeader } from './RecordHeader.tsx';
import { MenuItem, MenuSeparator } from '../Menu/Menu.tsx';
import { AIAssist } from '../AIAssist/AIAssist.tsx';
import { STAGES } from '../AttributeField/AttributeField.demo.tsx';
import type { AttributeValue } from '../AttributeField/AttributeField.tsx';

const companies = ['Acme Corp', 'Northwind', 'Globex', 'Initech'];
const subs = ['Logistics software · London · 1,240 people', 'Wholesale foods · Seattle · 310 people', 'Energy · Springfield · 8,400 people', 'Payments · Austin · 95 people'];

export function RecordHeaderDemo() {
  const [index, setIndex] = useState(7);
  const [names, setNames] = useState<ReadonlyArray<string>>(companies);
  const [starred, setStarred] = useState<ReadonlySet<number>>(new Set([7]));
  const [stage, setStage] = useState<AttributeValue>('qualified');
  const [asking, setAsking] = useState(false);
  const at = (index - 1) % 4;
  return (
    <div className="tf-demo tf-stack" style={{ gap: 'var(--space-16)' }}>
      <RecordHeader
        name={names[at] ?? ''} kind="company" sub={subs[at]}
        tags={[{ label: 'Customer', hue: 'green' }, { label: 'Enterprise', hue: 'purple' }, { label: 'Series B', ai: true }]}
        onRename={(n) => setNames((list) => list.map((x, i) => (i === at ? n : x)))}
        isStarred={starred.has(index)} onStarChange={(v) => setStarred((s) => { const n = new Set(s); if (v) n.add(index); else n.delete(index); return n; })}
        onAskAI={() => setAsking((v) => !v)} isAskOpen={asking}
        onEmail={() => undefined}
        moreActions={<>
          <MenuItem id="copy" icon={<Link2 size={16} strokeWidth={1.75} />} kbd="⌘C">Copy link</MenuItem>
          <MenuItem id="duplicate" icon={<Copy size={16} strokeWidth={1.75} />}>Duplicate</MenuItem>
          <MenuItem id="merge" icon={<Merge size={16} strokeWidth={1.75} />}>Merge with…</MenuItem>
          <MenuSeparator />
          <MenuItem id="delete" icon={<Trash2 size={16} strokeWidth={1.75} />} isDanger>Delete company</MenuItem>
        </>}
        stage={{ attribute: STAGES, value: stage, onChange: setStage }}
        position={{ index, total: 70, onPrevious: () => setIndex((i) => Math.max(1, i - 1)), onNext: () => setIndex((i) => Math.min(70, i + 1)) }}
      />
      {asking && (
        <AIAssist context={names[at] ?? ''} onClose={() => setAsking(false)}
          suggestions={['Summarise this company', 'What changed this week?', 'Who should I talk to next?']}
          onAsk={() => new Promise((r) => window.setTimeout(() => r(`${names[at] ?? 'They'} moved from Lead to Qualified on Tuesday after a 45 minute demo with Sam Kim. Priya Raman asked for security docs and a pilot price; the proposal is due Friday.`), 2400))} />
      )}
    </div>
  );
}
