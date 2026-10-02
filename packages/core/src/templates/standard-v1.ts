// The standard objects every workspace starts with (spec 0004, AC-1), version
// 1, from the attribute research (docs/research/crm-attributes.md, 5b), launch
// types only. Creating a workspace copies this into ordinary object, attribute
// and option rows marked standard, then links them with the standard
// relationships. Derived and read only attributes (interactions, won at, time
// in stage) arrive with the features that compute them.
import type { AttributeInput, ObjectInput } from '../engine/definitions.ts';
import type { OptionOutcome } from '../engine/options.ts';
import type { Cardinality } from '../engine/relationships.ts';

/** The template's version, stored on each object it makes. */
export const STANDARD_TEMPLATE_VERSION = 1;

/** One option a standard select or status attribute starts with. */
export interface StandardOption {
  readonly label: string;
  readonly hue: string;
  readonly outcome?: OptionOutcome;
}

/** One standard attribute: an attribute input, its options, and whether its default is its first option. */
export type StandardAttribute = Omit<AttributeInput, 'objectId'> & {
  readonly options?: readonly StandardOption[];
  readonly defaultFirstOption?: boolean;
};

/** One standard object and the attributes it gets beyond its system and primary ones. */
export interface StandardObject {
  readonly object: Omit<ObjectInput, 'standard'> & { readonly standardKey: string };
  readonly attributes: readonly StandardAttribute[];
}

const SOCIAL = ['linkedin', 'twitter', 'facebook', 'instagram', 'angellist'] as const;
const SOCIAL_TITLES: Record<(typeof SOCIAL)[number], string> = {
  linkedin: 'LinkedIn',
  twitter: 'Twitter',
  facebook: 'Facebook',
  instagram: 'Instagram',
  angellist: 'AngelList',
};
const socials: readonly StandardAttribute[] = SOCIAL.map((apiSlug) => ({
  apiSlug,
  title: SOCIAL_TITLES[apiSlug],
  type: 'url',
}));

const options = (labels: readonly string[], hues: readonly string[]): readonly StandardOption[] =>
  labels.map((label, index) => ({ label, hue: hues[index % hues.length] ?? 'gray' }));

/** The standard objects, in sidebar order. */
export const STANDARD_OBJECTS: readonly StandardObject[] = [
  {
    object: {
      standardKey: 'people',
      apiSlug: 'people',
      singularName: 'Person',
      pluralName: 'People',
      icon: 'user',
      hue: 'blue',
      primaryAttribute: { apiSlug: 'name', title: 'Name', type: 'personal_name' },
    },
    attributes: [
      { apiSlug: 'email_addresses', title: 'Email addresses', type: 'email', isMulti: true, isUnique: true },
      { apiSlug: 'phone_numbers', title: 'Phone numbers', type: 'phone', isMulti: true },
      { apiSlug: 'job_title', title: 'Job title', type: 'text' },
      { apiSlug: 'description', title: 'Description', type: 'long_text' },
      { apiSlug: 'primary_location', title: 'Primary location', type: 'location' },
      { apiSlug: 'avatar', title: 'Avatar', type: 'url' },
      ...socials,
      { apiSlug: 'owner', title: 'Owner', type: 'actor_reference' },
      { apiSlug: 'timezone', title: 'Time zone', type: 'text' },
      { apiSlug: 'email_opt_out', title: 'Email opt out', type: 'checkbox' },
    ],
  },
  {
    object: {
      standardKey: 'companies',
      apiSlug: 'companies',
      singularName: 'Company',
      pluralName: 'Companies',
      icon: 'building',
      hue: 'purple',
    },
    attributes: [
      { apiSlug: 'domains', title: 'Domains', type: 'domain', isMulti: true, isUnique: true },
      { apiSlug: 'description', title: 'Description', type: 'long_text' },
      { apiSlug: 'logo', title: 'Logo', type: 'url' },
      { apiSlug: 'categories', title: 'Categories', type: 'select', isMulti: true },
      { apiSlug: 'primary_location', title: 'Primary location', type: 'location' },
      { apiSlug: 'phone', title: 'Phone', type: 'phone' },
      ...socials,
      {
        apiSlug: 'employee_range',
        title: 'Employee range',
        type: 'select',
        options: options(
          [
            '1 to 10',
            '11 to 50',
            '51 to 200',
            '201 to 500',
            '501 to 1,000',
            '1,001 to 5,000',
            '5,001 to 10,000',
            'Over 10,000',
          ],
          ['gray', 'sky', 'blue', 'purple'],
        ),
      },
      {
        apiSlug: 'estimated_arr',
        title: 'Estimated ARR',
        type: 'select',
        options: options(
          [
            'Under $1M',
            '$1M to $10M',
            '$10M to $50M',
            '$50M to $100M',
            '$100M to $250M',
            '$250M to $500M',
            '$500M to $1B',
            'Over $1B',
          ],
          ['gray', 'lime', 'green', 'sky'],
        ),
      },
      { apiSlug: 'annual_revenue', title: 'Annual revenue', type: 'currency', config: { defaultCurrency: 'USD' } },
      { apiSlug: 'funding_raised', title: 'Funding raised', type: 'currency', config: { defaultCurrency: 'USD' } },
      { apiSlug: 'foundation_date', title: 'Foundation date', type: 'date' },
      { apiSlug: 'owner', title: 'Owner', type: 'actor_reference' },
    ],
  },
  {
    object: {
      standardKey: 'deals',
      apiSlug: 'deals',
      singularName: 'Deal',
      pluralName: 'Deals',
      icon: 'handshake',
      hue: 'green',
      primaryAttribute: { apiSlug: 'name', title: 'Name', type: 'text', isRequired: true },
    },
    attributes: [
      {
        apiSlug: 'stage',
        title: 'Stage',
        type: 'status',
        isRequired: true,
        defaultFirstOption: true,
        options: [
          { label: 'Lead', hue: 'sky', outcome: 'open' },
          { label: 'In progress', hue: 'yellow', outcome: 'open' },
          { label: 'Won', hue: 'green', outcome: 'won' },
          { label: 'Lost', hue: 'red', outcome: 'lost' },
        ],
      },
      {
        apiSlug: 'owner',
        title: 'Owner',
        type: 'actor_reference',
        isRequired: true,
        defaultValue: { kind: 'current_user' },
      },
      { apiSlug: 'value', title: 'Value', type: 'currency', config: { defaultCurrency: 'USD' } },
      { apiSlug: 'close_date', title: 'Close date', type: 'date' },
      { apiSlug: 'probability', title: 'Probability', type: 'number', config: { display: 'percent' } },
      {
        apiSlug: 'source',
        title: 'Source',
        type: 'select',
        options: options(
          ['Inbound', 'Outbound', 'Referral', 'Partner', 'Event', 'Other'],
          ['blue', 'purple', 'green', 'orange', 'yellow', 'gray'],
        ),
      },
      {
        apiSlug: 'deal_type',
        title: 'Deal type',
        type: 'select',
        options: options(['New business', 'Existing business'], ['green', 'blue']),
      },
      { apiSlug: 'next_step', title: 'Next step', type: 'text' },
      {
        apiSlug: 'lost_reason',
        title: 'Lost reason',
        type: 'select',
        options: options(
          ['Price', 'Timing', 'Competitor', 'No decision', 'Other'],
          ['red', 'orange', 'purple', 'gray', 'gray'],
        ),
      },
      { apiSlug: 'description', title: 'Description', type: 'long_text' },
    ],
  },
];

/** One end of a standard relationship: the standard object it sits on, by key, and its attribute. */
export interface StandardEnd {
  readonly object: string;
  readonly apiSlug: string;
  readonly title: string;
}

/** One standard relationship, read from its defining end. */
export interface StandardRelationship {
  readonly cardinality: Cardinality;
  readonly from: StandardEnd;
  readonly to: StandardEnd;
}

/** The standard relationships, from research 5b. */
export const STANDARD_RELATIONSHIPS: readonly StandardRelationship[] = [
  {
    cardinality: 'many_to_one',
    from: { object: 'people', apiSlug: 'company', title: 'Company' },
    to: { object: 'companies', apiSlug: 'team', title: 'Team' },
  },
  {
    cardinality: 'many_to_one',
    from: { object: 'companies', apiSlug: 'parent_company', title: 'Parent company' },
    to: { object: 'companies', apiSlug: 'subsidiaries', title: 'Subsidiaries' },
  },
  {
    cardinality: 'many_to_one',
    from: { object: 'deals', apiSlug: 'associated_company', title: 'Associated company' },
    to: { object: 'companies', apiSlug: 'associated_deals', title: 'Associated deals' },
  },
  {
    cardinality: 'many_to_many',
    from: { object: 'deals', apiSlug: 'associated_people', title: 'Associated people' },
    to: { object: 'people', apiSlug: 'associated_deals', title: 'Associated deals' },
  },
];
