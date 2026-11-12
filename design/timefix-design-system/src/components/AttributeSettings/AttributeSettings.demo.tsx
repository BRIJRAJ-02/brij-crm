import { useState } from 'react';
import { AttributeSettings, type SchemaAttribute } from './AttributeSettings.tsx';
import { DEMO_PEOPLE, DEMO_COMPANIES } from '../AttributeField/AttributeField.demo.tsx';

const DEAL_ATTRIBUTES: ReadonlyArray<SchemaAttribute> = [
  { id: 'name', name: 'Deal name', type: 'text', isRequired: true, isSystem: true },
  { id: 'value', name: 'Deal value', type: 'currency', currency: 'USD', isRequired: true },
  {
    id: 'stage', name: 'Stage', type: 'status', isRequired: true,
    options: [
      { id: 'lead', label: 'Lead', hue: 'gray', shape: 'draft', group: 'notStarted' },
      { id: 'qualified', label: 'Qualified', hue: 'orange', shape: 'progress', group: 'inProgress' },
      { id: 'proposal', label: 'Proposal', hue: 'blue', shape: 'review', group: 'inProgress' },
      { id: 'won', label: 'Won', hue: 'green', shape: 'done', group: 'done' },
      { id: 'lost', label: 'Lost', hue: 'red', shape: 'failed', group: 'done' },
    ],
  },
  { id: 'chance', name: 'Win chance', type: 'percent' },
  { id: 'close', name: 'Close date', type: 'date' },
  { id: 'owner', name: 'Owner', type: 'actor', candidates: DEMO_PEOPLE },
  { id: 'company', name: 'Company', type: 'record', candidates: DEMO_COMPANIES },
  { id: 'source', name: 'Source', type: 'select', options: [{ id: 'web', label: 'Website', hue: 'blue' }, { id: 'ref', label: 'Referral', hue: 'green' }, { id: 'ev', label: 'Event', hue: 'orange' }] },
  { id: 'code', name: 'Contract ID', type: 'text', isUnique: true },
];

export function AttributeSettingsDemo() {
  const [attributes, setAttributes] = useState(DEAL_ATTRIBUTES);
  return (
    <div className="tf-demo tf-demo--canvas">
      <p className="tf-demo-label">Drag a grip (or Enter on it, arrows, Enter) to reorder. Press a row to edit; change its type to see the warning. New attribute opens the type picker.</p>
      <div style={{ maxWidth: 'var(--size-dialog-wide)' }}>
        <AttributeSettings objectName="Deal" objectPlural="Deals" attributes={attributes} onChange={setAttributes} valueCounts={{ value: 1204, chance: 980, code: 1188, close: 1012 }} />
      </div>
    </div>
  );
}
