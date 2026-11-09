import { useState } from 'react';
import { Sentence, type Condition, type Conjunction } from './Sentence.tsx';
import type { Attribute } from '../AttributeField/AttributeField.tsx';
import { STAGES, DEMO_PEOPLE } from '../AttributeField/AttributeField.demo.tsx';

const ATTRS: ReadonlyArray<Attribute> = [
  STAGES,
  { id: 'value', name: 'Deal value', type: 'currency', currency: 'USD' },
  { id: 'owner', name: 'Owner', type: 'actor', candidates: DEMO_PEOPLE },
  { id: 'close', name: 'Close date', type: 'date' },
  { id: 'source', name: 'Source', type: 'select', options: [{ id: 'web', label: 'Website', hue: 'blue' }, { id: 'ref', label: 'Referral', hue: 'green' }, { id: 'ev', label: 'Event', hue: 'orange' }] },
  { id: 'nda', name: 'Signed NDA', type: 'checkbox' },
  { id: 'domain', name: 'Domain', type: 'domain' },
];

export function SentenceDemo() {
  const [conditions, setConditions] = useState<ReadonlyArray<Condition>>([
    { id: 'c1', attributeId: 'stage', operator: 'is', value: 'qualified' },
    { id: 'c2', attributeId: 'value', operator: 'gt', value: 10000 },
  ]);
  const [conj, setConj] = useState<Conjunction>('and');
  const [routing, setRouting] = useState<ReadonlyArray<Condition>>([{ id: 'r1', attributeId: 'owner', operator: 'is', value: DEMO_PEOPLE[0] }]);
  const [rConj, setRConj] = useState<Conjunction>('or');
  return (
    <div className="tf-demo" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 'var(--space-32)', alignItems: 'start' }}>
      <div className="tf-stack">
        <p className="tf-demo-label">Automation trigger. Press any pill to change it; press and to switch to or.</p>
        <Sentence label="Trigger conditions" lead="When" attributes={ATTRS} conditions={conditions} onChange={setConditions} conjunction={conj} onConjunctionChange={setConj} />
      </div>
      <div className="tf-stack">
        <p className="tf-demo-label">Read only, as a rule's summary shows it.</p>
        <Sentence label="Routing rule" lead="Only if" attributes={ATTRS} conditions={[...routing, { id: 'r2', attributeId: 'close', operator: 'isEmpty' }]} onChange={setRouting} conjunction={rConj} onConjunctionChange={setRConj} isReadOnly />
      </div>
    </div>
  );
}
