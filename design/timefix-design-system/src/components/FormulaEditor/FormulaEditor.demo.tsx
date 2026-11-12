import { useState } from 'react';
import { FormulaEditor, type FormulaAttribute } from './FormulaEditor.tsx';

const ATTRS: ReadonlyArray<FormulaAttribute> = [
  { id: 'value', name: 'Deal value', type: 'currency' }, { id: 'chance', name: 'Win chance', type: 'percent' },
  { id: 'seats', name: 'Seats', type: 'number' }, { id: 'discount', name: 'Discount', type: 'percent' },
  { id: 'stage', name: 'Stage', type: 'status' }, { id: 'close', name: 'Close date', type: 'date' },
];
const SAMPLE = { name: 'Acme Corp', values: { value: 48000, chance: 0.65, seats: 40, discount: 0.1 } };
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function FormulaEditorDemo() {
  const [weighted, setWeighted] = useState('ROUND({Deal value} * {Win chance}, 0)');
  const [broken, setBroken] = useState('{Deal value} * (1 - {Discount}) / {Stage}');
  return (
    <div className="tf-demo" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-32)', alignItems: 'start' }}>
      <div className="tf-stack">
        <p className="tf-demo-label">Weighted value. Type @ for attributes, or a letter for functions.</p>
        <FormulaEditor label="Weighted value" value={weighted} onChange={setWeighted} attributes={ATTRS} sample={SAMPLE} format={usd} />
      </div>
      <div className="tf-stack">
        <p className="tf-demo-label">A problem: Stage isn&apos;t a number. Press Enter in the field to see it shake.</p>
        <FormulaEditor label="Net value" value={broken} onChange={setBroken} attributes={ATTRS} sample={SAMPLE} format={usd} />
      </div>
    </div>
  );
}
