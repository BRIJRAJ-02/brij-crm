// A sample attribute and value per type, for the field stories and the field
// set's surface test. Stories and tests only.
import type { ActorDisplay, AttributeType, RecordRefDisplay } from '@crm/contracts/values';
import type { FieldAttribute } from '../fields/types.ts';
import { attributeOf } from './attributes.ts';
import { SAMPLE_IDS } from './sample-ids.ts';

/** One type's sample: its attribute, a value, display shapes, and a list for types that hold several. */
export interface FieldSample {
  readonly attribute: FieldAttribute;
  readonly value: unknown;
  readonly display?: unknown;
  readonly several?: { readonly attribute: FieldAttribute; readonly value: unknown; readonly display?: unknown };
}

const ID = SAMPLE_IDS;

const STAGES = [
  { id: ID.stage.lead, label: 'Lead', hue: 'gray', archived: false },
  { id: ID.stage.qualified, label: 'Qualified', hue: 'sky', archived: false },
  { id: ID.stage.proposal, label: 'Proposal', hue: 'purple', archived: false },
  { id: ID.stage.won, label: 'Won', hue: 'green', archived: false },
  { id: ID.stage.legacy, label: 'Legacy', hue: 'orange', archived: true },
] as const;

const TAGS = [
  { id: ID.tag.saas, label: 'SaaS', hue: 'blue', archived: false },
  { id: ID.tag.fintech, label: 'Fintech', hue: 'green', archived: false },
  { id: ID.tag.b2b, label: 'B2B', hue: 'purple', archived: false },
  { id: ID.tag.emea, label: 'EMEA', hue: 'orange', archived: false },
  { id: ID.tag.old, label: 'Old segment', hue: 'gray', archived: true },
] as const;

const MEMBERS: readonly ActorDisplay[] = [
  { type: 'member', id: ID.member.ada, name: 'Ada Lovelace', email: 'ada@northwind.com', hue: 'orange' },
  { type: 'member', id: ID.member.grace, name: 'Grace Hopper', email: 'grace@northwind.com', hue: 'sky' },
  { type: 'member', id: ID.member.alan, name: 'Alan Turing', email: 'alan@northwind.com', hue: 'green' },
  {
    type: 'member',
    id: ID.member.katherine,
    name: 'Katherine Johnson',
    email: 'katherine@northwind.com',
    hue: 'purple',
  },
];

const COMPANIES: readonly RecordRefDisplay[] = [
  { objectId: ID.companies, recordId: ID.company.northwind, name: 'Northwind Traders', kind: 'company', hue: 'blue' },
  { objectId: ID.companies, recordId: ID.company.globex, name: 'Globex', kind: 'company', hue: 'red' },
  { objectId: ID.companies, recordId: ID.company.initech, name: 'Initech', kind: 'company', hue: 'lime' },
  { objectId: ID.companies, recordId: ID.company.umbrella, name: 'Umbrella', kind: 'company', hue: 'purple' },
];

/** The members the actor stories pick from. */
export const SAMPLE_MEMBERS = MEMBERS;

/** The companies the record reference stories pick from. */
export const SAMPLE_COMPANIES = COMPANIES;

/** The pipeline stages the status samples use. */
export const SAMPLE_STAGES = STAGES;

/** The segment tags the select samples use. */
export const SAMPLE_TAGS = TAGS;

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
    value: ID.tag.saas,
    several: {
      attribute: attributeOf('select', 'Tags', { options: TAGS, allowMultiple: true }),
      value: [ID.tag.saas, ID.tag.fintech, ID.tag.b2b, ID.tag.emea, ID.tag.old],
    },
  },
  status: { attribute: attributeOf('status', 'Stage', { options: STAGES }), value: ID.stage.proposal },
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
    value: { type: 'member', id: ID.member.ada },
    display: MEMBERS[0],
    several: {
      attribute: attributeOf('actor_reference', 'Team', { allowMultiple: true }),
      value: MEMBERS.map((member) => ({ type: 'member', id: member.id })),
      display: MEMBERS,
    },
  },
  record_reference: {
    attribute: attributeOf('record_reference', 'Company', { cardinality: 'one' }),
    value: { objectId: ID.companies, recordId: ID.company.northwind },
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
    value: { kind: 'email', at: '2026-10-08T11:30:00.000Z', by: { type: 'member', id: ID.member.grace } },
    display: MEMBERS[1],
  },
};
