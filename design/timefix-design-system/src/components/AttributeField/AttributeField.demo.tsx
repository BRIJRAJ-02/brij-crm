import { useState } from 'react';
import { AttributeField, AttributeIcon, ATTRIBUTE_TYPES, type Attribute, type AttributeValue, type PersonRef, type AttributeRecordRef } from './AttributeField.tsx';

/** Sample people and companies the record and person pickers search. */
export const DEMO_PEOPLE: ReadonlyArray<PersonRef> = [
  { id: 'p1', name: 'Priya Raman' }, { id: 'p2', name: 'Sam Kim' }, { id: 'p3', name: 'Jo Mendes' }, { id: 'p4', name: 'Ava Chen' }, { id: 'p5', name: 'Maria Bell' },
];
/** Sample records for record references. */
export const DEMO_COMPANIES: ReadonlyArray<AttributeRecordRef> = [
  { id: 'c1', name: 'Acme Corp', kind: 'company' }, { id: 'c2', name: 'Northwind', kind: 'company' }, { id: 'c3', name: 'Globex', kind: 'company' }, { id: 'c4', name: 'Initech', kind: 'company' },
];
/** The deal stages every records demo uses. */
export const STAGES: Attribute = {
  id: 'stage', name: 'Stage', type: 'status',
  options: [
    { id: 'lead', label: 'Lead', hue: 'gray', shape: 'draft' }, { id: 'qualified', label: 'Qualified', hue: 'orange', shape: 'progress' },
    { id: 'proposal', label: 'Proposal', hue: 'blue', shape: 'review' }, { id: 'won', label: 'Won', hue: 'green', shape: 'done' }, { id: 'lost', label: 'Lost', hue: 'red', shape: 'failed' },
  ],
};

const rows: ReadonlyArray<readonly [Attribute, AttributeValue]> = [
  [{ id: 'a1', name: 'Description', type: 'text' }, 'Workflow software for logistics teams'],
  [{ id: 'a2', name: 'About', type: 'longText', isAI: true }, 'Acme builds dispatch and routing tools for mid-size freight companies. Raised a Series B in March; hiring across sales and support.'],
  [{ id: 'a3', name: 'Employees', type: 'number' }, 1240],
  [{ id: 'a4', name: 'Deal value', type: 'currency', currency: 'USD' }, 48000],
  [{ id: 'a5', name: 'Win chance', type: 'percent' }, 0.65],
  [{ id: 'a6', name: 'Renewal', type: 'date' }, '2026-12-01'],
  [{ id: 'a7', name: 'Created', type: 'timestamp' }, '2026-10-14T09:42:00'],
  [{ id: 'a8', name: 'Signed NDA', type: 'checkbox' }, true],
  [{ id: 'a9', name: 'Industry', type: 'select', options: [{ id: 'log', label: 'Logistics', hue: 'sky' }, { id: 'saas', label: 'Software', hue: 'purple' }, { id: 'fin', label: 'Finance', hue: 'green' }, { id: 'hc', label: 'Healthcare', hue: 'red' }] }, 'log'],
  [{ id: 'a10', name: 'Channels', type: 'multiSelect', options: [{ id: 'web', label: 'Website', hue: 'blue' }, { id: 'ref', label: 'Referral', hue: 'green' }, { id: 'ev', label: 'Event', hue: 'orange' }, { id: 'ads', label: 'Ads', hue: 'yellow' }, { id: 'out', label: 'Outbound', hue: 'gray' }] }, ['web', 'ref']],
  [STAGES, 'qualified'],
  [{ id: 'a12', name: 'Fit', type: 'rating' }, 4],
  [{ id: 'a13', name: 'Email', type: 'email' }, 'priya@acme.com'],
  [{ id: 'a14', name: 'Phone', type: 'phone' }, '+44 20 7946 0958'],
  [{ id: 'a15', name: 'Pricing page', type: 'url' }, 'https://acme.com/pricing'],
  [{ id: 'a16', name: 'Domain', type: 'domain', isAI: true }, 'acme.com'],
  [{ id: 'a17', name: 'Headquarters', type: 'location' }, { city: 'London', country: 'United Kingdom' }],
  [{ id: 'a18', name: 'Contact', type: 'personalName' }, { first: 'Priya', last: 'Raman' }],
  [{ id: 'a19', name: 'Company', type: 'record', candidates: DEMO_COMPANIES }, DEMO_COMPANIES[0]],
  [{ id: 'a20', name: 'Owner', type: 'actor', candidates: DEMO_PEOPLE }, DEMO_PEOPLE[1]],
  [{ id: 'a21', name: 'Files', type: 'file' }, [{ id: 'f1', name: 'Proposal v3.pdf', size: 2_400_000 }]],
  [{ id: 'a22', name: 'Notes', type: 'text' }, undefined],
];

export function AttributeFieldDemo() {
  const [values, setValues] = useState<Readonly<Record<string, AttributeValue>>>(() => Object.fromEntries(rows.map(([a, v]) => [a.id, v])));
  return (
    <div className="tf-demo">
      <p className="tf-demo-label">One display and one editor per type. Press a value to edit it; Enter saves, Esc puts it back.</p>
      <div className="tf-attr-gallery">
        {rows.map(([a]) => (
          <div key={a.id} className="tf-attr-gallery__row">
            <span className="tf-attr-gallery__type"><AttributeIcon type={a.type} />{a.id === 'a22' ? 'Empty' : ATTRIBUTE_TYPES[a.type].label}</span>
            <span className="tf-attr-gallery__value">
              <AttributeField attribute={a} value={values[a.id]} onChange={(v) => setValues((s) => ({ ...s, [a.id]: v }))} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
