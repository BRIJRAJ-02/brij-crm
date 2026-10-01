// A sample attribute and value per type, for the field stories and the field
// set's surface test. Stories and tests only.
import type { ActorDisplay, AttributeType, RecordRefDisplay } from '@crm/contracts/values';
import type { FieldAttribute } from '../fields/types.ts';
import { attributeOf } from './attributes.ts';

/** One type's sample: its attribute, a value, display shapes, and a list for types that hold several. */
export interface FieldSample {
  readonly attribute: FieldAttribute;
  readonly value: unknown;
  readonly display?: unknown;
  readonly several?: { readonly attribute: FieldAttribute; readonly value: unknown; readonly display?: unknown };
}

const STAGES = [
  { id: 'lead', label: 'Lead', hue: 'gray', archived: false },
  { id: 'qualified', label: 'Qualified', hue: 'sky', archived: false },
  { id: 'proposal', label: 'Proposal', hue: 'purple', archived: false },
  { id: 'won', label: 'Won', hue: 'green', archived: false },
  { id: 'legacy', label: 'Legacy', hue: 'orange', archived: true },
] as const;

const TAGS = [
  { id: 'saas', label: 'SaaS', hue: 'blue', archived: false },
  { id: 'fintech', label: 'Fintech', hue: 'green', archived: false },
  { id: 'b2b', label: 'B2B', hue: 'purple', archived: false },
  { id: 'emea', label: 'EMEA', hue: 'orange', archived: false },
  { id: 'old', label: 'Old segment', hue: 'gray', archived: true },
] as const;

const MEMBERS: readonly ActorDisplay[] = [
  { type: 'member', id: 'm1', name: 'Ada Lovelace', email: 'ada@northwind.com', hue: 'orange' },
  { type: 'member', id: 'm2', name: 'Grace Hopper', email: 'grace@northwind.com', hue: 'sky' },
  { type: 'member', id: 'm3', name: 'Alan Turing', email: 'alan@northwind.com', hue: 'green' },
  { type: 'member', id: 'm4', name: 'Katherine Johnson', email: 'katherine@northwind.com', hue: 'purple' },
];

const COMPANIES: readonly RecordRefDisplay[] = [
  { objectId: 'companies', recordId: 'c1', name: 'Northwind Traders', kind: 'company', hue: 'blue' },
  { objectId: 'companies', recordId: 'c2', name: 'Globex', kind: 'company', hue: 'red' },
  { objectId: 'companies', recordId: 'c3', name: 'Initech', kind: 'company', hue: 'lime' },
  { objectId: 'companies', recordId: 'c4', name: 'Umbrella', kind: 'company', hue: 'purple' },
];

/** The members the actor stories pick from. */
export const SAMPLE_MEMBERS = MEMBERS;

/** The companies the record reference stories pick from. */
export const SAMPLE_COMPANIES = COMPANIES;

/** A sample per attribute type. */
export const FIELD_SAMPLES: { readonly [T in AttributeType]: FieldSample } = {
  text: { attribute: attributeOf('text', 'Name'), value: 'Northwind Traders' },
  long_text: {
    attribute: attributeOf('long_text', 'Description'),
    value: 'A wholesale distributor in Portland.\nMet at SaaStr; interested in the API and the imports.',
  },
  number: { attribute: attributeOf('number', 'Employees'), value: '1250' },
  currency: {
    attribute: attributeOf('currency', 'Deal value', { defaultCurrency: 'USD' }),
    value: { amount: '48000', currency: 'EUR' },
  },
  date: { attribute: attributeOf('date', 'Close date'), value: '2026-10-15' },
  timestamp: {
    attribute: attributeOf('timestamp', 'Created', { isReadOnly: true }),
    value: '2026-10-08T11:30:00.000Z',
  },
  checkbox: { attribute: attributeOf('checkbox', 'Is customer'), value: true },
  select: {
    attribute: attributeOf('select', 'Segment', { options: TAGS }),
    value: 'saas',
    several: {
      attribute: attributeOf('select', 'Tags', { options: TAGS, allowMultiple: true }),
      value: ['saas', 'fintech', 'b2b', 'emea', 'old'],
    },
  },
  status: { attribute: attributeOf('status', 'Stage', { options: STAGES }), value: 'proposal' },
  rating: { attribute: attributeOf('rating', 'Fit'), value: 4 },
  email: {
    attribute: attributeOf('email', 'Email'),
    value: 'ada@example.com',
    several: {
      attribute: attributeOf('email', 'Emails', { allowMultiple: true }),
      value: ['ada@example.com', 'ada@work.example.com', 'lovelace@example.org', 'a@example.net'],
    },
  },
  phone: {
    attribute: attributeOf('phone', 'Phone', { defaultCountry: 'GB' }),
    value: { number: '+442071234567', country: 'GB' },
    several: {
      attribute: attributeOf('phone', 'Phones', { allowMultiple: true }),
      value: [
        { number: '+442071234567', country: 'GB' },
        { number: '+12125550100', country: 'US' },
        { number: '+4930901820', country: 'DE' },
      ],
    },
  },
  domain: {
    attribute: attributeOf('domain', 'Domain'),
    value: 'northwind.com',
    several: {
      attribute: attributeOf('domain', 'Domains', { allowMultiple: true }),
      value: ['northwind.com', 'northwind.co.uk', 'nw-traders.com', 'northwind.io'],
    },
  },
  url: { attribute: attributeOf('url', 'Website'), value: 'https://northwind.com/pricing' },
  location: {
    attribute: attributeOf('location', 'Office'),
    value: { line1: '12 Market Street', locality: 'London', postcode: 'EC1A 1BB', countryCode: 'GB' },
  },
  personal_name: {
    attribute: attributeOf('personal_name', 'Name'),
    value: { firstName: 'Ada', lastName: 'Lovelace', fullName: 'Ada Lovelace' },
  },
  actor_reference: {
    attribute: attributeOf('actor_reference', 'Owner'),
    value: { type: 'member', id: 'm1' },
    display: MEMBERS[0],
    several: {
      attribute: attributeOf('actor_reference', 'Team', { allowMultiple: true }),
      value: MEMBERS.map((member) => ({ type: 'member', id: member.id })),
      display: MEMBERS,
    },
  },
  record_reference: {
    attribute: attributeOf('record_reference', 'Company', { cardinality: 'one' }),
    value: { objectId: 'companies', recordId: 'c1' },
    display: COMPANIES[0],
    several: {
      attribute: attributeOf('record_reference', 'Partners', { cardinality: 'many', allowMultiple: true }),
      value: COMPANIES.map((company) => ({ objectId: company.objectId, recordId: company.recordId })),
      display: COMPANIES,
    },
  },
  file: {
    attribute: attributeOf('file', 'Contract'),
    value: { fileId: 'f1', name: 'Master services agreement.pdf', size: 284_000, contentType: 'application/pdf' },
    several: {
      attribute: attributeOf('file', 'Files', { allowMultiple: true }),
      value: [
        { fileId: 'f1', name: 'MSA.pdf', size: 284_000, contentType: 'application/pdf' },
        { fileId: 'f2', name: 'Logo.png', size: 84_000, contentType: 'image/png' },
        { fileId: 'f3', name: 'Pricing.xlsx', size: 46_000, contentType: 'application/vnd.ms-excel' },
        { fileId: 'f4', name: 'Kickoff.mp4', size: 48_000_000, contentType: 'video/mp4' },
      ],
    },
  },
  interaction: {
    attribute: attributeOf('interaction', 'Last email'),
    value: { kind: 'email', at: '2026-10-08T11:30:00.000Z', by: { type: 'member', id: 'm2' } },
    display: MEMBERS[1],
  },
};
