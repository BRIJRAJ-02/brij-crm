// An object's attributes as the People table reads and adds them (spec 0005):
// the definitions that make its columns, and "Add attribute", whose API name
// the server derives from the title.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { AttributeDefault } from './values/attribute-config.ts';
import { AttributeType } from './values/attribute-values.ts';
import { Hue } from './values/hues.ts';
import { WorkspaceScoped } from './workspaces.ts';

/**
 * Why the caller can't change an attribute's values (spec 0009, AC-142): the
 * object's reason when they may only read the object, else the field rule's,
 * else the system's. Shown on the cell; the server checks every write anyway.
 */
export const AttributeReadOnly = z.object({ reason: z.string() });
/** Why the caller can't change an attribute's values. */
export type AttributeReadOnly = z.infer<typeof AttributeReadOnly>;

/**
 * One option of a select or status attribute, inline on its definition (spec
 * 0006, AC-59; spec 0012): its id (what values hold), label, hue, place in the
 * attribute's order, whether it is archived (still shown on the values that
 * hold it, refused for new ones), and for a status stage its outcome and the
 * target time in stage (an ISO 8601 duration).
 */
export const AttributeOption = z.object({
  id: z.uuid(),
  label: z.string(),
  hue: Hue,
  position: z.number().int(),
  isArchived: z.boolean(),
  outcome: z.enum(['open', 'won', 'lost']).optional(),
  targetTimeInStage: z.string().optional(),
});
/** One option of a select or status attribute. */
export type AttributeOption = z.infer<typeof AttributeOption>;

/**
 * One attribute of an object: its id (what values are keyed by), its object,
 * its API name, its title and description, type and rules, its type's
 * settings, its default, and its place in the object's order. System
 * attributes (record id, created at and by, updated at and by) are listed
 * too, marked `isSystem`; the one records are named by is `isPrimary`. Only
 * attributes the caller may see are listed (spec 0009, AC-141), and
 * `readOnly` says why one can't be changed by them, when it can't. Archived
 * ones are listed only when asked for (settings), with `isArchived`; one
 * whose relationship's far object is archived is archived too, with
 * `archivedBy` naming that object (spec 0012, AC-226). Select and status
 * attributes carry their options inline, archived ones included.
 */
export const AttributeDefinition = z.object({
  id: z.uuid(),
  objectId: z.uuid(),
  apiSlug: z.string(),
  title: z.string(),
  description: z.string().optional(),
  type: AttributeType,
  isMulti: z.boolean(),
  isRequired: z.boolean(),
  isUnique: z.boolean(),
  isSystem: z.boolean(),
  isPrimary: z.boolean(),
  config: z.record(z.string(), z.unknown()),
  defaultValue: AttributeDefault.optional(),
  position: z.number().int(),
  isArchived: z.boolean(),
  archivedBy: z.object({ objectId: z.uuid() }).optional(),
  options: z.array(AttributeOption).optional(),
  readOnly: AttributeReadOnly.optional(),
});
/** One attribute of an object. */
export type AttributeDefinition = z.infer<typeof AttributeDefinition>;

/** Which object's attributes to read. */
export const ListAttributesInput = WorkspaceScoped.extend({
  objectId: z.uuid(),
  /** Settings only: the archived attributes too (spec 0012, AC-227). */
  includeArchived: z.boolean().optional(),
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
 * (system attributes first, marked), and the archived ones too with
 * `includeArchived`. `create` waits for the server and
 * refuses `SLUG_TAKEN` on the `title` field when the derived API name is
 * taken, `LIMIT_REACHED` when the object is full, and `CONFIG_INVALID`.
 * Repeating a `create` whose response was lost answers the attribute it made.
 * An unknown object is 404 `NOT_FOUND`, like a workspace you're not in.
 */
export const attributesContract = {
  list: oc.input(ListAttributesInput).output(z.array(AttributeDefinition)),
  create: oc.input(CreateAttributeInput).output(AttributeDefinition),
};
