// An object's attributes as the tables read them and settings shape them
// (spec 0005; spec 0012): the definitions that make the columns, and the
// writes that create, edit, move, archive and restore them.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { AttributeDefault } from './values/attribute-config.ts';
import { AttributeType } from './values/attribute-values.ts';
import { AttributeRelationship } from './relationship-block.ts';
import { Hue } from './values/hues.ts';
import { AttributeValidation, ValidationRuleInput } from './values/validation-rules.ts';
import { WorkspaceScoped } from './workspaces.ts';
import { Uuid, uuidV7 } from './values/ids.ts';

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
  id: Uuid,
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
  id: Uuid,
  objectId: Uuid,
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
  archivedBy: z.object({ objectId: Uuid }).optional(),
  options: z.array(AttributeOption).optional(),
  readOnly: AttributeReadOnly.optional(),
  /**
   * Its validation (spec 0013): Required (never, always, or when; `isRequired`
   * is exactly `required === 'always'`) and its rules, in order, each rule
   * whose condition names an attribute hidden from the reader left out.
   */
  validation: AttributeValidation.optional(),
  /** A record reference's relationship (spec 0014). */
  relationship: AttributeRelationship.optional(),
});
/** One attribute of an object. */
export type AttributeDefinition = z.infer<typeof AttributeDefinition>;

/** Which object's attributes to read. */
export const ListAttributesInput = WorkspaceScoped.extend({
  objectId: Uuid,
  /** Settings only: the archived attributes too (spec 0012, AC-227). */
  includeArchived: z.boolean().optional(),
});
/** Which object's attributes to read. */
export type ListAttributesInput = z.infer<typeof ListAttributesInput>;

/**
 * The attribute types the type picker makes (spec 0012, AC-228): the types
 * behind `PICKER_TYPES`, Multi select being a `select` with `isMulti`, Link a
 * `url` and Member an `actor_reference`. Record references are made only
 * through a relationship (#15). File arrived with record files (27 Oct
 * 2026), so a form's file question has an attribute to file onto.
 */
export const PickerAttributeType = z.enum([
  'text',
  'long_text',
  'number',
  'currency',
  'date',
  'checkbox',
  'select',
  'status',
  'rating',
  'email',
  'phone',
  'url',
  'location',
  'actor_reference',
  'file',
]);
/** An attribute type the picker makes. */
export type PickerAttributeType = z.infer<typeof PickerAttributeType>;

/** An attribute's rules as sent: twice the limit, so a list a little over it still answers the engine's `LIMIT_REACHED`. */
const AttributeRules = z.array(ValidationRuleInput).max(40, 'An attribute holds at most 20 rules.');

/** An attribute's title: 1 to 100 characters, trimmed. */
const AttributeTitle = z.string().trim().min(1, 'Name the attribute.').max(100, 'Use at most 100 characters.');

/** An attribute's description: at most 500 characters (spec 0012). */
const AttributeDescription = z.string().max(500, 'Keep the description to 500 characters.');

/** An option's label: 1 to 100 characters, trimmed (spec 0012, AC-236). */
export const OptionLabel = z.string().trim().min(1, 'Give the option a label.').max(100, 'Use at most 100 characters.');

/** A status stage's outcome: still open, won or lost. */
export const OptionOutcome = z.enum(['open', 'won', 'lost']);
/** A status stage's outcome. */
export type OptionOutcome = z.infer<typeof OptionOutcome>;

/**
 * A status stage's target time in stage, in whole days from 1 to 365, as an
 * ISO 8601 duration (`P7D`), the one unit settings offer (spec 0012).
 */
export const TargetDays = z
  .string()
  .regex(/^P[1-9]\d{0,2}D$/, 'Give the target as whole days, from 1 to 365.')
  .refine((value) => Number(value.slice(1, -1)) <= 365, 'Give the target as whole days, from 1 to 365.');

/**
 * One option a new select or status attribute starts with (spec 0012,
 * AC-230): its client id (UUID v7), label and hue, and for a status stage its
 * outcome and target time.
 */
export const NewAttributeOption = z.object({
  id: uuidV7('An option id must be a UUID v7.'),
  label: OptionLabel,
  hue: Hue,
  outcome: OptionOutcome.optional(),
  targetTimeInStage: TargetDays.optional(),
});
/** One option a new attribute starts with. */
export type NewAttributeOption = z.infer<typeof NewAttributeOption>;

/**
 * A new attribute (spec 0012, AC-229). `id` is a UUID v7 the browser mints
 * and the retry key: the same request again answers the attribute already
 * made. `apiSlug` is derived from `title` (`toApiSlug`) when absent; the
 * engine checks its shape (`CONFIG_INVALID` on `apiSlug`). `isMulti` makes a
 * Multi select, or allows several members, emails or phones. `config` and
 * `defaultValue` are checked by the type's own schemas. A select or status
 * attribute takes its first `options` (at most 500 live, AC-237).
 * `mutationId` is the write's own uuid, echoed in its event.
 */
export const CreateAttributeInput = WorkspaceScoped.extend({
  objectId: Uuid,
  id: uuidV7('The attribute id must be a UUID v7.'),
  title: AttributeTitle,
  type: PickerAttributeType,
  apiSlug: z.string().max(100, { error: 'Keep the API name to 100 characters.' }).optional(),
  description: AttributeDescription.optional(),
  isMulti: z.boolean().optional(),
  isRequired: z.boolean().optional(),
  isUnique: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  defaultValue: AttributeDefault.optional(),
  // Twice the limit, so a list a little over it still answers the engine's LIMIT_REACHED, and junk stops at parsing.
  options: z.array(NewAttributeOption).max(1000, 'An attribute holds at most 500 options.').optional(),
  /** Its rules, in order (spec 0013, AC-252); at most 20 (`LIMIT_REACHED`). */
  rules: AttributeRules.optional(),
  mutationId: Uuid,
});
/** A new attribute. */
export type CreateAttributeInput = z.infer<typeof CreateAttributeInput>;

/**
 * An attribute's settings, changed (spec 0012, AC-231). Its type, its
 * multiple setting and its API name never change here (#14 changes types).
 * `description` and `defaultValue` take `null` to clear.
 */
export const UpdateAttributeInput = WorkspaceScoped.extend({
  attributeId: Uuid,
  title: AttributeTitle.optional(),
  description: AttributeDescription.nullable().optional(),
  isRequired: z.boolean().optional(),
  isUnique: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  defaultValue: AttributeDefault.nullable().optional(),
  /**
   * Its rules, in order (spec 0013, AC-252): the list replaces the
   * attribute's own rules (one left out is deleted); at most 20.
   */
  rules: AttributeRules.optional(),
  mutationId: Uuid,
});
/** An attribute's settings, changed. */
export type UpdateAttributeInput = z.infer<typeof UpdateAttributeInput>;

/**
 * An attribute moved to `position` among its object's own attributes,
 * archived ones counted, system ones never (spec 0012, AC-232).
 */
export const ReorderAttributeInput = WorkspaceScoped.extend({
  attributeId: Uuid,
  position: z.number().int().min(0),
  mutationId: Uuid,
});
/** An attribute moved in its object's order. */
export type ReorderAttributeInput = z.infer<typeof ReorderAttributeInput>;

/** One attribute to archive or restore (spec 0012, AC-233). */
export const AttributeWriteInput = WorkspaceScoped.extend({
  attributeId: Uuid,
  mutationId: Uuid,
});
/** One attribute to archive or restore. */
export type AttributeWriteInput = z.infer<typeof AttributeWriteInput>;

/**
 * An object's attributes. `list` answers the live ones in position order
 * (system attributes first, marked), and the archived ones too with
 * `includeArchived`. Every write needs `schema.manage` (403 `FORBIDDEN`),
 * waits for the server and stores one `definitions` event per object it
 * touched. `create` refuses `SLUG_TAKEN` (on `apiSlug`), `CONFIG_INVALID`
 * (on its field when it names one), `LIMIT_REACHED` and `ID_TAKEN`;
 * repeating a `create` whose answer was lost answers the attribute it made.
 * `update` refuses `UNIQUE_HAS_DUPLICATES`, `CONFIG_INVALID` and
 * `ATTRIBUTE_READ_ONLY` (a system attribute). `reorder` answers the object's
 * attributes, archived ones included, in their new order. `archive` and
 * `restore` act on both ends of a relationship and answer every definition
 * they changed; `restore` refuses `NOT_FOUND` ("Restore <Plural> first.")
 * while the far end's object is archived and `UNIQUE_HAS_DUPLICATES`. An
 * unknown or hidden object or attribute is 404 `NOT_FOUND`, like a
 * workspace you're not in.
 */
/** Which attribute's uses and counts to read. */
export const AttributeImpactInput = WorkspaceScoped.extend({ attributeId: Uuid });
/** Which attribute's uses and counts to read. */
export type AttributeImpactInput = z.infer<typeof AttributeImpactInput>;

/**
 * What changing or archiving an attribute touches (flow pass, 30 October 2026): the views using it (shared ones and
 * the reader's own, each with how: grouping, filtering or sorting), the forms filing onto it, and how many other
 * attributes' rules look at it. For a reader who sees every record of the object: `emptyCount` (live records with
 * no value), `optionCounts` (a select or status: live records holding each option, by option id) and
 * `duplicateCount` (a type that can be unique: values more than one live record shares).
 */
export const AttributeImpact = z.object({
  views: z.array(z.object({ id: Uuid, name: z.string(), uses: z.array(z.enum(['group', 'filter', 'sort'])).min(1) })),
  forms: z.array(z.object({ id: Uuid, name: z.string() })),
  rules: z.number().int().min(0),
  emptyCount: z.number().int().min(0).optional(),
  optionCounts: z.record(Uuid, z.number().int().min(0)).optional(),
  duplicateCount: z.number().int().min(0).optional(),
});
/** What changing or archiving an attribute touches. */
export type AttributeImpact = z.infer<typeof AttributeImpact>;

export const attributesContract = {
  list: oc.input(ListAttributesInput).output(z.array(AttributeDefinition)),
  create: oc.input(CreateAttributeInput).output(AttributeDefinition),
  update: oc.input(UpdateAttributeInput).output(AttributeDefinition),
  reorder: oc.input(ReorderAttributeInput).output(z.array(AttributeDefinition)),
  archive: oc.input(AttributeWriteInput).output(z.array(AttributeDefinition)),
  restore: oc.input(AttributeWriteInput).output(z.array(AttributeDefinition)),
  /** Read only: `FORBIDDEN` without `schema.manage`, `NOT_FOUND` for an attribute the reader can't see. */
  impact: oc.input(AttributeImpactInput).output(AttributeImpact),
};
