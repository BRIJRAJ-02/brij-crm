import { useState } from 'react';
import { OptionsEditor, type EditableOption } from './OptionsEditor.tsx';

const INDUSTRIES: ReadonlyArray<EditableOption> = [
  { id: 'log', label: 'Logistics', hue: 'sky' }, { id: 'saas', label: 'Software', hue: 'purple' }, { id: 'fin', label: 'Finance', hue: 'green' },
  { id: 'hc', label: 'Healthcare', hue: 'red' }, { id: 'old', label: 'Telecom', hue: 'gray', archived: true },
];
const STAGES: ReadonlyArray<EditableOption> = [
  { id: 'lead', label: 'Lead', hue: 'gray', shape: 'draft', group: 'notStarted' },
  { id: 'qualified', label: 'Qualified', hue: 'orange', shape: 'progress', group: 'inProgress' },
  { id: 'demo', label: 'Demo booked', hue: 'yellow', shape: 'progress', group: 'inProgress' },
  { id: 'proposal', label: 'Proposal', hue: 'blue', shape: 'review', group: 'inProgress' },
  { id: 'won', label: 'Won', hue: 'green', shape: 'done', group: 'done' },
  { id: 'lost', label: 'Lost', hue: 'red', shape: 'failed', group: 'done' },
];

export function OptionsEditorDemo() {
  const [industries, setIndustries] = useState(INDUSTRIES);
  const [stages, setStages] = useState(STAGES);
  return (
    <div className="tf-demo" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-32)', alignItems: 'start' }}>
      <div className="tf-stack">
        <p className="tf-demo-label">Select: Industry. Press a swatch for its colour; Enter in a name adds the next; archive shows Undo.</p>
        <OptionsEditor kind="select" label="Options" options={industries} onChange={setIndustries} />
      </div>
      <div className="tf-stack">
        <p className="tf-demo-label">Status: Deal stage. Drag a stage between groups; it takes the group&apos;s shape.</p>
        <OptionsEditor kind="status" label="Stages" options={stages} onChange={setStages} />
      </div>
    </div>
  );
}
