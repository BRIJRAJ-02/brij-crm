// Companies for the grid's stories and its 100,000 row test: columns of the
// heavier types, and rows made from their index, so a source of any size
// needs no array. Stories and tests only.
import type { ActorDisplay, RecordRefDisplay } from '@crm/contracts/values';
import { columnWidthFor } from '../fields/registry.ts';
import type { FieldAttribute } from '../fields/types.ts';
import type { GridColumn } from '../modules/DataGrid/grid-columns.ts';
import { attributeOf } from './attributes.ts';
import { SAMPLE_COMPANIES, SAMPLE_MEMBERS, SAMPLE_STAGES, SAMPLE_TAGS } from './field-samples.ts';
import { SAMPLE_IDS } from './sample-ids.ts';

/** One sample company: its id, and its values and display shapes by column id. */
export interface SampleRow {
  readonly id: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly displays: Readonly<Record<string, unknown>>;
}

/** A column at its type's width tier. */
export function sampleColumn(attribute: FieldAttribute): GridColumn {
  return { id: attribute.id, attribute, width: columnWidthFor(attribute) };
}

const BASE: readonly FieldAttribute[] = [
  attributeOf('text', 'Name', { isRequired: true }),
  attributeOf('domain', 'Domain'),
  attributeOf('number', 'Employees'),
  attributeOf('currency', 'ARR', { defaultCurrency: 'USD' }),
  attributeOf('select', 'Segment', { options: SAMPLE_TAGS }),
  attributeOf('status', 'Stage', { options: SAMPLE_STAGES }),
  attributeOf('date', 'Next step'),
  attributeOf('actor_reference', 'Owner'),
  attributeOf('checkbox', 'Is customer'),
];

const MORE: readonly FieldAttribute[] = [
  attributeOf('record_reference', 'Parent', { cardinality: 'one' }),
  attributeOf('rating', 'Fit'),
  attributeOf('number', 'Open deals'),
  attributeOf('currency', 'Pipeline', { defaultCurrency: 'USD' }),
  attributeOf('text', 'City'),
  attributeOf('status', 'Health', { options: SAMPLE_STAGES }),
  attributeOf('date', 'Renewal'),
  attributeOf('select', 'Region', { options: SAMPLE_TAGS }),
  attributeOf('record_reference', 'Partner', { cardinality: 'one' }),
  attributeOf('checkbox', 'Has API'),
  attributeOf('timestamp', 'Created', {
    isReadOnly: true,
    readOnlyReason: 'The system sets this when the record is made.',
  }),
];

/** The sample columns: the first nine, or up to 20 for the wide and performance stories. */
export function sampleColumns(count = BASE.length): readonly GridColumn[] {
  return [...BASE, ...MORE].slice(0, count).map(sampleColumn);
}

const NAMES = ['Northwind', 'Globex', 'Initech', 'Umbrella', 'Hooli', 'Vandelay', 'Stark', 'Wayne', 'Acme', 'Soylent'];
const KINDS = ['Traders', 'Labs', 'Systems', 'Works', 'Group', 'Partners', 'Foods', 'Logistics'];
const CITIES = ['London', 'Berlin', 'Lisbon', 'Austin', 'Toronto', 'Sydney', 'Pune', 'Osaka'];
const pick = <T>(list: readonly T[], index: number): T => list[index % list.length] as T;

/** The sample company at `index`: the same values every time, so screenshots and tests are steady. */
export function sampleRowAt(index: number): SampleRow {
  const name = `${pick(NAMES, index)} ${pick(KINDS, Math.floor(index / NAMES.length))}${index >= 80 ? ` ${String(Math.floor(index / 80))}` : ''}`;
  const owner: ActorDisplay = pick(SAMPLE_MEMBERS, index * 7);
  const parent: RecordRefDisplay = pick(SAMPLE_COMPANIES, index * 3);
  const partner: RecordRefDisplay = pick(SAMPLE_COMPANIES, index * 5 + 1);
  const month = String((index % 12) + 1).padStart(2, '0');
  const day = String((index % 27) + 1).padStart(2, '0');
  const values: Record<string, unknown> = {
    name,
    domain: `${name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '')}.com`,
    employees: String(((index * 37) % 4990) + 10),
    arr: { amount: String(((index * 7919) % 900_000) + 12_000), currency: 'USD' },
    segment: pick(SAMPLE_TAGS, index).id === SAMPLE_IDS.tag.old ? SAMPLE_IDS.tag.saas : pick(SAMPLE_TAGS, index).id,
    stage:
      pick(SAMPLE_STAGES, index * 3).id === SAMPLE_IDS.stage.legacy
        ? SAMPLE_IDS.stage.lead
        : pick(SAMPLE_STAGES, index * 3).id,
    next_step: `2026-${month}-${day}`,
    owner: { type: 'member', id: owner.id },
    is_customer: index % 3 === 0,
    parent: { objectId: parent.objectId, recordId: parent.recordId },
    fit: (index % 5) + 1,
    open_deals: String(index % 9),
    pipeline: { amount: String(((index * 104_729) % 400_000) + 5_000), currency: 'USD' },
    city: pick(CITIES, index),
    health:
      pick(SAMPLE_STAGES, index).id === SAMPLE_IDS.stage.legacy ? SAMPLE_IDS.stage.won : pick(SAMPLE_STAGES, index).id,
    renewal: `2027-${month}-${day}`,
    region:
      pick(SAMPLE_TAGS, index + 3).id === SAMPLE_IDS.tag.old ? SAMPLE_IDS.tag.emea : pick(SAMPLE_TAGS, index + 3).id,
    partner: { objectId: partner.objectId, recordId: partner.recordId },
    has_api: index % 4 === 0,
    created: '2026-10-01T09:00:00.000Z',
  };
  return { id: `company-${String(index)}`, values, displays: { owner, parent, partner } };
}

/** The first `count` sample companies, for stories that edit them. */
export function sampleRows(count: number): readonly SampleRow[] {
  return Array.from({ length: count }, (_, index) => sampleRowAt(index));
}
