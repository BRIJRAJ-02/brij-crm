// 100,000 synthetic people for the prototype gate (AC-40): 20 columns of the
// heavier types, like the grid's own 100,000 row story, and a record made
// from its index, so the fake server holds nothing until it's asked.
import type { GridColumn } from '@crm/ui/grid';
import { columnWidthFor } from '@crm/ui/grid';
import type { FieldAttribute } from '@crm/ui';
import type { RecordBody } from '../../src/records/store.ts';

/** A synthetic record as the server would send it: values, the display shapes the grid draws, and timestamps. */
export interface SyntheticRecord extends RecordBody {
  readonly objectId: string;
  readonly displays: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const STAGES = [
  { id: 'lead', label: 'Lead', hue: 'gray', archived: false },
  { id: 'qualified', label: 'Qualified', hue: 'sky', archived: false },
  { id: 'proposal', label: 'Proposal', hue: 'purple', archived: false },
  { id: 'won', label: 'Won', hue: 'green', archived: false },
] as const;

const TAGS = [
  { id: 'saas', label: 'SaaS', hue: 'blue', archived: false },
  { id: 'fintech', label: 'Fintech', hue: 'green', archived: false },
  { id: 'b2b', label: 'B2B', hue: 'purple', archived: false },
  { id: 'emea', label: 'EMEA', hue: 'orange', archived: false },
] as const;

const MEMBERS = [
  { type: 'member', id: 'm1', name: 'Ada Lovelace', email: 'ada@northwind.com', hue: 'orange' },
  { type: 'member', id: 'm2', name: 'Grace Hopper', email: 'grace@northwind.com', hue: 'sky' },
  { type: 'member', id: 'm3', name: 'Alan Turing', email: 'alan@northwind.com', hue: 'green' },
] as const;

const COMPANIES = [
  { objectId: 'companies', recordId: 'c1', name: 'Northwind Traders', kind: 'company', hue: 'blue' },
  { objectId: 'companies', recordId: 'c2', name: 'Globex', kind: 'company', hue: 'red' },
  { objectId: 'companies', recordId: 'c3', name: 'Initech', kind: 'company', hue: 'lime' },
] as const;

const attribute = (type: FieldAttribute['type'], name: string, more: Partial<FieldAttribute> = {}): FieldAttribute => ({
  id: name.toLowerCase().replaceAll(/\W+/g, '_'),
  name,
  type,
  allowMultiple: false,
  isRequired: false,
  isUnique: false,
  isReadOnly: false,
  ...more,
});

const ATTRIBUTES: readonly FieldAttribute[] = [
  attribute('text', 'Name', { isRequired: true }),
  attribute('domain', 'Domain'),
  attribute('number', 'Employees'),
  attribute('currency', 'ARR', { defaultCurrency: 'USD' }),
  attribute('select', 'Segment', { options: TAGS }),
  attribute('status', 'Stage', { options: STAGES }),
  attribute('date', 'Next step'),
  attribute('actor_reference', 'Owner'),
  attribute('checkbox', 'Is customer'),
  attribute('record_reference', 'Parent', { cardinality: 'one' }),
  attribute('rating', 'Fit'),
  attribute('number', 'Open deals'),
  attribute('currency', 'Pipeline', { defaultCurrency: 'USD' }),
  attribute('text', 'City'),
  attribute('status', 'Health', { options: STAGES }),
  attribute('date', 'Renewal'),
  attribute('select', 'Region', { options: TAGS }),
  attribute('record_reference', 'Partner', { cardinality: 'one' }),
  attribute('checkbox', 'Has API'),
  attribute('timestamp', 'Created', { isReadOnly: true, readOnlyReason: 'The system sets this.' }),
];

/** The 20 columns, at their type's width. */
export const COLUMNS: readonly GridColumn[] = ATTRIBUTES.map((each) => ({
  id: each.id,
  attribute: each,
  width: columnWidthFor(each),
}));

const NAMES = ['Northwind', 'Globex', 'Initech', 'Umbrella', 'Hooli', 'Vandelay', 'Stark', 'Wayne', 'Acme', 'Soylent'];
const KINDS = ['Traders', 'Labs', 'Systems', 'Works', 'Group', 'Partners', 'Foods', 'Logistics'];
const CITIES = ['London', 'Berlin', 'Lisbon', 'Austin', 'Toronto', 'Sydney', 'Pune', 'Osaka'];
const pick = <T>(list: readonly T[], index: number): T => list[index % list.length] as T;

/** A uuid v7 shaped id for `index`, in creation order like the real ones. */
export function idAt(index: number): string {
  const hex = index.toString(16).padStart(12, '0');
  return `0192f3a0-0000-7000-8000-${hex}`;
}

/** The record at `index`, with `values` changed by `override` (an edit or a patch). */
export function recordAt(index: number, override: Readonly<Record<string, unknown>> = {}): SyntheticRecord {
  const name = `${pick(NAMES, index)} ${pick(KINDS, Math.floor(index / NAMES.length))} ${String(index)}`;
  const owner = pick(MEMBERS, index * 7);
  const parent = pick(COMPANIES, index * 3);
  const partner = pick(COMPANIES, index * 5 + 1);
  const month = String((index % 12) + 1).padStart(2, '0');
  const day = String((index % 27) + 1).padStart(2, '0');
  return {
    id: idAt(index),
    objectId: 'people',
    values: {
      name,
      domain: `${name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '')}.com`,
      employees: String(((index * 37) % 4990) + 10),
      arr: { amount: String(((index * 7919) % 900_000) + 12_000), currency: 'USD' },
      segment: pick(TAGS, index).id,
      stage: pick(STAGES, index * 3).id,
      next_step: `2026-${month}-${day}`,
      owner: { type: 'member', id: owner.id },
      is_customer: index % 3 === 0,
      parent: { objectId: parent.objectId, recordId: parent.recordId },
      fit: (index % 5) + 1,
      open_deals: String(index % 9),
      pipeline: { amount: String(((index * 104_729) % 400_000) + 5_000), currency: 'USD' },
      city: pick(CITIES, index),
      health: pick(STAGES, index).id,
      renewal: `2027-${month}-${day}`,
      region: pick(TAGS, index + 3).id,
      partner: { objectId: partner.objectId, recordId: partner.recordId },
      has_api: index % 4 === 0,
      created: '2026-10-01T09:00:00.000Z',
      ...override,
    },
    displays: { owner, parent, partner },
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
  };
}

/** The fake server's `records.query`: the records at `offset`, after `latency` ms, unless aborted first. */
export function queryRecords(
  offset: number,
  limit: number,
  total: number,
  latency: number,
  signal: AbortSignal,
): Promise<readonly SyntheticRecord[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const end = Math.min(total, offset + limit);
      resolve(Array.from({ length: Math.max(0, end - offset) }, (_, at) => recordAt(offset + at)));
    }, latency);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
}
