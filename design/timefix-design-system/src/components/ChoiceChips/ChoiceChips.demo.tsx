import { useState } from 'react';
import { ChoiceChips } from './ChoiceChips.tsx';
import { Button } from '../Button/Button.tsx';

const lengths = [
  { id: '15', label: '15 min' },
  { id: '30', label: '30 min' },
  { id: '45', label: '45 min' },
  { id: '60', label: '60 min', isDisabled: true },
];
const products = [
  { id: 'scheduling', label: 'Scheduling', dot: 'blue' as const },
  { id: 'forms', label: 'Forms', dot: 'purple' as const },
  { id: 'links', label: 'Link pages', dot: 'green' as const },
  { id: 'crm', label: 'CRM', dot: 'orange' as const },
];
const stages = [
  { id: 'lead', label: 'Lead' },
  { id: 'qualified', label: 'Qualified' },
  { id: 'customer', label: 'Customer' },
  { id: 'churned', label: 'Churned' },
];

export function ChoiceChipsDemo() {
  const [length, setLength] = useState<ReadonlySet<string>>(new Set(['30']));
  const [interest, setInterest] = useState<ReadonlySet<string>>(new Set(['scheduling', 'crm']));
  const [stage, setStage] = useState<ReadonlySet<string>>(new Set(['lead', 'qualified']));
  return (
    <div className="tf-demo tf-stack" style={{ gap: 'var(--space-20)' }}>
      <ChoiceChips label="Meeting length" items={lengths} selectedKeys={length} onSelectionChange={setLength} />
      <ChoiceChips label="What are you interested in?" selectionMode="multiple" items={products} selectedKeys={interest} onSelectionChange={setInterest} />
      <ChoiceChips
        label="Stage"
        size="sm"
        selectionMode="multiple"
        items={stages}
        selectedKeys={stage}
        onSelectionChange={setStage}
        end={stage.size > 0 && <Button size="sm" variant="ghost" onPress={() => setStage(new Set())}>Clear</Button>}
      />
    </div>
  );
}
