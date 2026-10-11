// What a simulated user looks at and changes (spec 0011, AC-198): each
// object's fixed view shapes (from spec 0004's benchmark grid rows that are
// held), which attributes an edit may change, and what a create sends. A view
// runs in position mode only when `canJump` admits it, exactly as the People
// table picks; every filtered shape runs by cursor.
import type { FilterGroup, SortRules } from '@crm/contracts';
import { canJump, type JumpAttribute } from '@crm/contracts/jump';

/** The objects the harness drives, by standard key. */
export type ObjectKey = 'people' | 'companies' | 'deals';

/** Which object a user holds: People 50%, Deals 30%, Companies 20%. */
export const OBJECT_SHARES: readonly { readonly key: ObjectKey; readonly share: number }[] = [
  { key: 'people', share: 0.5 },
  { key: 'deals', share: 0.3 },
  { key: 'companies', share: 0.2 },
];

/** One view a user can hold: a name for the report, and its filter and sorts. */
export interface ViewShape {
  readonly name: string;
  readonly filter?: FilterGroup;
  readonly sorts?: SortRules;
}

/** What the shapes need to know of one attribute: its id, type, whether it is a system one, and its options. */
export interface ShapeAttribute extends JumpAttribute {
  readonly id: string;
  readonly isMulti: boolean;
  /** Option ids in order, for select and status attributes. */
  readonly options: readonly string[];
  /** The currency a currency attribute's values carry. */
  readonly currency?: string;
}

/** An object's attributes by API slug, and the members a shape may name. */
export interface ShapeContext {
  readonly attributes: ReadonlyMap<string, ShapeAttribute>;
  readonly memberIds: readonly string[];
}

function need(context: ShapeContext, slug: string): ShapeAttribute {
  const attribute = context.attributes.get(slug);
  if (attribute === undefined) throw new Error(`The seeded object has no "${slug}" attribute.`);
  return attribute;
}

function option(attribute: ShapeAttribute, index: number): string {
  const found = attribute.options[index % Math.max(attribute.options.length, 1)];
  if (found === undefined) throw new Error(`"${attribute.apiSlug}" has no options.`);
  return found;
}

const and = (...conditions: FilterGroup['conditions']): FilterGroup => ({ conjunction: 'and', conditions });
const by = (attribute: ShapeAttribute, direction: 'ascending' | 'descending' = 'ascending'): SortRules => [
  { attributeId: attribute.id, direction },
];

/**
 * The fixed shapes of one object: its plain view (no filter, no sort), sorted
 * by name (both by position), and the filtered shapes the spec names, each by
 * cursor.
 */
export function viewShapes(key: ObjectKey, context: ShapeContext): readonly ViewShape[] {
  const a = (slug: string) => need(context, slug);
  const member = context.memberIds[0];
  if (member === undefined) throw new Error('The seed has no members.');
  const plain: readonly ViewShape[] = [{ name: 'all' }, { name: 'by name', sorts: by(a('name')) }];
  switch (key) {
    case 'people':
      return [
        ...plain,
        {
          name: 'job title contains manager, by name',
          filter: and({ attributeId: a('job_title').id, operator: 'contains', value: 'manager' }),
          sorts: by(a('name')),
        },
        {
          name: 'owner is a member, by created',
          filter: and({ attributeId: a('owner').id, operator: 'is_any_of', values: [member] }),
          sorts: by(a('created_at')),
        },
        { name: 'email opt out', filter: and({ attributeId: a('email_opt_out').id, operator: 'is_checked' }) },
      ];
    case 'companies':
      return [
        ...plain,
        {
          name: 'categories include an industry, by name',
          filter: and({
            attributeId: a('categories').id,
            operator: 'contains_any_of',
            values: [option(a('categories'), 0)],
          }),
          sorts: by(a('name')),
        },
        {
          name: 'estimated ARR in a range',
          filter: and({
            attributeId: a('estimated_arr').id,
            operator: 'is_any_of',
            values: [option(a('estimated_arr'), 1), option(a('estimated_arr'), 2)],
          }),
        },
      ];
    case 'deals':
      return [
        ...plain,
        {
          name: 'stage is an option, by close date',
          filter: and({ attributeId: a('stage').id, operator: 'is', value: option(a('stage'), 1) }),
          sorts: by(a('close_date')),
        },
        {
          name: 'value above 100,000, by value descending',
          filter: and({
            attributeId: a('value').id,
            operator: 'gt',
            value: { amount: '100000', currency: a('value').currency ?? 'USD' },
          }),
          sorts: by(a('value'), 'descending'),
        },
        {
          name: 'name contains a rare word',
          filter: and({ attributeId: a('name').id, operator: 'contains', value: 'zephyr' }),
        },
        {
          name: 'owner is a member, closing in 30 days',
          filter: and(
            { attributeId: a('owner').id, operator: 'is_any_of', values: [member] },
            { attributeId: a('close_date').id, operator: 'within', range: { amount: 30, unit: 'day' } },
          ),
        },
      ];
  }
}

/** Whether a shape scrolls by position (true) or pages by cursor, by spec 0006's one rule. */
export function jumpsByPosition(shape: ViewShape, attributes: ReadonlyMap<string, ShapeAttribute>): boolean {
  const byId = new Map([...attributes.values()].map((attribute) => [attribute.id, attribute]));
  return canJump(shape.filter, shape.sorts, (id) => byId.get(id));
}

/** The attributes an edit may change, by object (the spec's list). */
export const EDITABLE: Readonly<Record<ObjectKey, readonly string[]>> = {
  people: ['job_title', 'email_opt_out', 'description'],
  companies: ['description', 'employee_range'],
  deals: ['stage', 'value', 'close_date', 'next_step'],
};

/**
 * A create's values: the name `Load <type> <id prefix>`, and a unique email
 * (People) or domain (Companies) made from the id; Deals also need their
 * required stage and owner.
 */
export function createValues(
  key: ObjectKey,
  id: string,
  context: ShapeContext & { readonly memberId: string },
): Readonly<Record<string, unknown>> {
  const a = (slug: string) => need(context, slug).id;
  const prefix = id.slice(0, 8);
  switch (key) {
    case 'people':
      return {
        [a('name')]: { firstName: 'Load', lastName: `person ${prefix}`, fullName: `Load person ${prefix}` },
        [a('email_addresses')]: [`${id}@load.example.com`],
      };
    case 'companies':
      return { [a('name')]: `Load company ${prefix}`, [a('domains')]: [`${id}.load.example.com`] };
    case 'deals':
      return {
        [a('name')]: `Load deal ${prefix}`,
        [a('stage')]: option(need(context, 'stage'), 0),
        [a('owner')]: { type: 'member', id: context.memberId },
      };
  }
}

/** How many columns a screen shows at once, the first by position (a 1440 pixel wide table). */
export const SCREEN_COLUMNS = 10;

/**
 * The attribute ids a window reads: the first `SCREEN_COLUMNS` attributes by
 * position, then every editable one and every one a shape filters or sorts
 * on, so an edit knows the value it changes. The primary attribute comes
 * anyway.
 */
export function columnsOnScreen(
  key: ObjectKey,
  attributes: readonly (ShapeAttribute & { readonly position: number })[],
  shapes: readonly ViewShape[],
): readonly string[] {
  const visible = [...attributes]
    .filter((attribute) => !attribute.isSystem)
    .sort((left, right) => left.position - right.position)
    .slice(0, SCREEN_COLUMNS)
    .map((attribute) => attribute.id);
  const editable = attributes.filter((attribute) => EDITABLE[key].includes(attribute.apiSlug)).map((each) => each.id);
  const named = shapes.flatMap((shape) => [
    ...(shape.sorts ?? []).map((sort) => sort.attributeId),
    ...(shape.filter?.conditions ?? []).flatMap((condition) =>
      'attributeId' in condition ? [condition.attributeId] : [],
    ),
  ]);
  return [...new Set([...visible, ...editable, ...named])];
}
