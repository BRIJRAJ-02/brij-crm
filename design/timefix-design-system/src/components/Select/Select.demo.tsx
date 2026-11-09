import { useState } from 'react';
import { Select, MultiSelect, type SelectOption } from './Select.tsx';
import type { Hue } from '../Tag/Tag.tsx';

const stages: ReadonlyArray<SelectOption> = [
  { id: 'draft', label: 'Draft', status: 'draft' },
  { id: 'progress', label: 'In progress', status: 'progress' },
  { id: 'review', label: 'In review', status: 'review' },
  { id: 'done', label: 'Won', status: 'done' },
  { id: 'lost', label: 'Lost', status: 'failed' },
  { id: 'waiting', label: 'Waiting on client', status: 'waiting' },
];
const roles: ReadonlyArray<SelectOption> = [
  { id: 'owner', label: 'Owner', description: 'Billing, members and every setting' },
  { id: 'admin', label: 'Admin', description: 'Members and workspace settings' },
  { id: 'member', label: 'Member', description: 'Records, bookings and forms' },
  { id: 'guest', label: 'Guest', description: 'Only what is shared with them', isDisabled: true },
];
const currencies: ReadonlyArray<SelectOption> = [
  ['USD', 'US dollar'], ['EUR', 'Euro'], ['GBP', 'British pound'], ['INR', 'Indian rupee'], ['JPY', 'Japanese yen'], ['AUD', 'Australian dollar'],
  ['CAD', 'Canadian dollar'], ['SGD', 'Singapore dollar'], ['AED', 'UAE dirham'], ['CHF', 'Swiss franc'], ['SEK', 'Swedish krona'], ['BRL', 'Brazilian real'],
].map(([code = '', name = '']) => ({ id: code, label: `${code} · ${name}` }));
const HUES: ReadonlyArray<Hue> = ['blue', 'green', 'purple', 'red', 'orange', 'sky', 'yellow', 'lime'];
const initialSegments: ReadonlyArray<SelectOption> = ['Enterprise', 'SMB', 'Partner', 'Churn risk', 'Upsell', 'Trial', 'Agency', 'Education', 'Nonprofit']
  .map((label, n) => ({ id: label.toLowerCase(), label, hue: HUES[n % HUES.length] }));

export function SelectDemo() {
  const [stage, setStage] = useState<string | null>('progress');
  const [segments, setSegments] = useState(initialSegments);
  const [picked, setPicked] = useState<ReadonlyArray<string>>(['enterprise', 'upsell', 'partner']);
  const create = (label: string) => {
    const id = label.toLowerCase();
    setSegments((s) => [...s, { id, label, hue: HUES[s.length % HUES.length] }]);
    return id;
  };
  return (
    <div className="tf-demo" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 'var(--space-24) var(--space-20)' }}>
      <Select label="Stage" items={stages} optionStyle="tag" value={stage} onChange={setStage} />
      <Select label="Role" items={roles} defaultValue="member" description="Owners can change this later." />
      <Select label="Currency" items={currencies} defaultValue="INR" />
      <MultiSelect label="Segments" items={segments} values={picked} onChange={setPicked} onCreate={create} />
      <Select label="Booking page" items={[{ id: 'a', label: 'Discovery call' }, { id: 'b', label: 'Demo 45 min' }]} isInvalid errorMessage="Choose where guests book." />
      <Select label="Owner" items={[{ id: 'p', label: 'Priya Raman' }]} defaultValue="p" isDisabled />
    </div>
  );
}
