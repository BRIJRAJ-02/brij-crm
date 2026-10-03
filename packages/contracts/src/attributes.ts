// An object's attributes as the People table reads and adds them (spec 0005):
// the definitions that make its columns, and "Add attribute", whose API name
// the server derives from the title.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { AttributeType } from './values/attribute-values.ts';
import { WorkspaceScoped } from './workspaces.ts';

/**
 * One live attribute of an object: its id (what values are keyed by), its API
 * name, its title, type and rules, its type's settings, and its place in the
 * object's order. System attributes (record id, created at and by, updated at
 * and by) are listed too, marked `isSystem`.
 */
export const AttributeDefinition = z.object({
  id: z.uuid(),
  apiSlug: z.string(),
  title: z.string(),
  type: AttributeType,
  isMulti: z.boolean(),
  isRequired: z.boolean(),
  isUnique: z.boolean(),
  isSystem: z.boolean(),
  config: z.record(z.string(), z.unknown()),
  position: z.number().int(),
});
/** One live attribute of an object. */
export type AttributeDefinition = z.infer<typeof AttributeDefinition>;

/** Which object's attributes to read. */
export const ListAttributesInput = WorkspaceScoped.extend({
  objectId: z.uuid(),
});
/** Which object's attributes to read. */
export type ListAttributesInput = z.infer<typeof ListAttributesInput>;

/** The types "Add attribute" offers in the core loop; select, status, currency and relations come with #13. */
export const CreatableAttributeType = z.enum([
  'text',
  'long_text',
  'number',
  'date',
  'checkbox',
  'email',
  'url',
  'rating',
]);
/** A type "Add attribute" offers. */
export type CreatableAttributeType = z.infer<typeof CreatableAttributeType>;

/**
 * Adding an attribute to an object. The server derives its API name from
 * `title` (`attributeSlugFrom`). `mutationId` is a uuid the browser mints for
 * this write, echoed in its change event.
 */
export const CreateAttributeInput = WorkspaceScoped.extend({
  objectId: z.uuid(),
  title: z.string().trim().min(1, 'Name the attribute.').max(100, 'Use at most 100 characters.'),
  type: CreatableAttributeType,
  mutationId: z.uuid(),
});
/** Adding an attribute to an object. */
export type CreateAttributeInput = z.infer<typeof CreateAttributeInput>;

/** The longest API name an attribute may have (the engine's rule). */
const MAX_SLUG = 63;

/**
 * An attribute's API name from its title (spec 0005, value sourcing): accents
 * dropped, lowercased, runs of letters and digits joined by `_`, at most 63
 * characters. A title with no letter or digit left gives `attribute`, and one
 * that starts with a digit gets `attribute_` in front, since an API name
 * starts with a letter. "Job title" gives `job_title`, "Café" gives `cafe`,
 * "2026 goals" gives `attribute_2026_goals`.
 */
export function attributeSlugFrom(title: string): string {
  const words = title
    .normalize('NFKD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .match(/[a-z0-9]+/g);
  const joined = (words ?? []).join('_');
  const slug = joined === '' ? 'attribute' : /^[0-9]/.test(joined) ? `attribute_${joined}` : joined;
  return slug.slice(0, MAX_SLUG).replace(/_+$/, '');
}

/**
 * An object's attributes. `list` answers the live ones in position order
 * (system attributes first, marked). `create` waits for the server and
 * refuses `SLUG_TAKEN` on the `title` field when the derived API name is
 * taken, `LIMIT_REACHED` when the object is full, and `CONFIG_INVALID`.
 * Repeating a `create` whose response was lost answers the attribute it made.
 * An unknown object is 404 `NOT_FOUND`, like a workspace you're not in.
 */
export const attributesContract = {
  list: oc.input(ListAttributesInput).output(z.array(AttributeDefinition)),
  create: oc.input(CreateAttributeInput).output(AttributeDefinition),
};
