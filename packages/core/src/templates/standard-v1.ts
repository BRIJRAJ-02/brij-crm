// The standard objects every workspace starts with (spec 0004, AC-1), version
// 1. Creating a workspace copies this into ordinary object and attribute rows
// marked standard. Milestone 2 fills in People, Companies and Deals from the
// attribute research (docs/research/crm-attributes.md, 5b).
import type { AttributeInput, ObjectInput } from '../engine/definitions.ts';

/** The template's version, stored on each object it makes. */
export const STANDARD_TEMPLATE_VERSION = 1;

/** One standard object and the attributes it gets beyond its system and primary ones. */
export interface StandardObject {
  readonly object: Omit<ObjectInput, 'standard'> & { readonly standardKey: string };
  readonly attributes: readonly Omit<AttributeInput, 'objectId'>[];
}

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
    attributes: [{ apiSlug: 'email_addresses', title: 'Email addresses', type: 'email', isMulti: true }],
  },
];
