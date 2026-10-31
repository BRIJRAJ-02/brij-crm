// Computed attributes (spec 0015): the definitions a lookup, a rollup and a
// formula store, the block an attribute's definition carries, and the
// `computed` procedures (preview and refill). The rules both sides share live
// in `computed-rules.ts` (`@crm/contracts/computed`, no Zod).
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { ROLLUP_CALCS } from './computed-rules.ts';
import { FORMULA_LIMITS } from './formula/parse.ts';
import { AttributeType } from './values/attribute-values.ts';
import { CURRENCY_CODES } from './values/currencies.ts';
import { FilterGroup } from './values/filters.ts';
import { Uuid } from './values/ids.ts';
import { RecordRefDisplay } from './values/options.ts';
import { WorkspaceScoped } from './workspaces.ts';

/** A lookup: the related record's attribute, shown through one of this object's relationship sides (AC-313). */
export const LookupDefinition = z.strictObject({
  kind: z.literal('lookup'),
  /** This object's side of a two way relationship. */
  via: Uuid,
  /** The related object's attribute. */
  target: Uuid,
});
/** A lookup's definition. */
export type LookupDefinition = z.infer<typeof LookupDefinition>;

/**
 * A rollup (AC-315): a calculation over the records linked through `via`; `target` for every calculation but the
 * counts, `where` (the related object's own attributes, no paths) for Count where, `currency` for a Currency one.
 */
export const RollupDefinition = z.strictObject({
  kind: z.literal('rollup'),
  via: Uuid,
  calc: z.enum(ROLLUP_CALCS),
  target: Uuid.optional(),
  where: FilterGroup.optional(),
  currency: z.enum(CURRENCY_CODES, { error: 'Pick a currency, such as USD or EUR.' }).optional(),
});
/** A rollup's definition. */
export type RollupDefinition = z.infer<typeof RollupDefinition>;

/** A formula's source as typed: at most 2,000 characters (AC-331). */
const FormulaSource = z
  .string()
  .min(1, 'Write a formula.')
  .max(FORMULA_LIMITS.source, 'Keep a formula to 2,000 characters.');

/** A formula as stored: its source (with `{{api_slug}}` references, for editing) and its checked tree (ids). */
export const FormulaDefinition = z.strictObject({
  kind: z.literal('formula'),
  source: FormulaSource,
  /** The tree `checkFormula` resolved: references by id. Rebuilt from the source on every write. */
  ast: z.unknown(),
});
/** A formula's definition. */
export type FormulaDefinition = z.infer<typeof FormulaDefinition>;

/** What a computed attribute stores (spec 0015): exactly one of the three kinds. */
export const ComputedDefinition = z.discriminatedUnion('kind', [LookupDefinition, RollupDefinition, FormulaDefinition]);
/** What a computed attribute stores. */
export type ComputedDefinition = z.infer<typeof ComputedDefinition>;

/** A formula as sent: its source only, which the server parses and checks. */
export const FormulaDefinitionInput = z.strictObject({ kind: z.literal('formula'), source: FormulaSource });
/** A formula as sent. */
export type FormulaDefinitionInput = z.infer<typeof FormulaDefinitionInput>;

/** A computed definition as the dialog and the API send it. */
export const ComputedDefinitionInput = z.discriminatedUnion('kind', [
  LookupDefinition,
  RollupDefinition,
  FormulaDefinitionInput,
]);
/** A computed definition as sent. */
export type ComputedDefinitionInput = z.infer<typeof ComputedDefinitionInput>;

/** A computed attribute's result type: how its values are stored and shown. */
export const ComputedResultType = z.object({ type: AttributeType, isMulti: z.boolean() });
/** A computed attribute's result type. */
export type ComputedResultType = z.infer<typeof ComputedResultType>;

/**
 * The computed block of an attribute's definition (AC-312): its kind and definition as sent, where its values
 * stand, why it stopped updating, its result type, and while a fill runs, its job and progress (read from the job's
 * row, so every member sees the header's progress).
 */
export const AttributeComputed = z.object({
  kind: z.enum(['lookup', 'rollup', 'formula']),
  definition: ComputedDefinitionInput,
  state: z.enum(['filling', 'ok', 'broken']),
  error: z.string().optional(),
  resultType: ComputedResultType,
  fillJobId: Uuid.optional(),
  done: z.number().int().min(0).optional(),
  total: z.number().int().min(0).optional(),
});
/** The computed block of an attribute's definition. */
export type AttributeComputed = z.infer<typeof AttributeComputed>;

/** What the preview works out: a definition on an object, before it is created. */
export const ComputedPreviewInput = WorkspaceScoped.extend({
  objectId: Uuid,
  definition: ComputedDefinitionInput,
});
/** What the preview works out. */
export type ComputedPreviewInput = z.infer<typeof ComputedPreviewInput>;

/**
 * The preview (AC-312, AC-317): the result type, or the first error (with its character for a formula), and the
 * values it gives for up to 5 of the object's most recently updated records the caller may see.
 */
export const ComputedPreview = z.object({
  resultType: ComputedResultType.optional(),
  error: z.object({ message: z.string(), position: z.number().int().min(0).optional() }).optional(),
  samples: z.array(z.object({ record: RecordRefDisplay, value: z.unknown() })).max(5),
});
/** The preview. */
export type ComputedPreview = z.infer<typeof ComputedPreview>;

/** Which attribute to work out again after its fill failed (AC-334). */
export const ComputedRefillInput = WorkspaceScoped.extend({ attributeId: Uuid, mutationId: Uuid });
/** Which attribute to work out again. */
export type ComputedRefillInput = z.infer<typeof ComputedRefillInput>;

/**
 * The computed procedures. Both need `schema.manage` (403 `FORBIDDEN`). `preview` writes nothing; `refill` starts
 * the attribute's fill again and answers it `filling` (409 `CONFIG_INVALID` unless a failed fill broke it).
 */
export const computedContract = {
  preview: oc.input(ComputedPreviewInput).output(ComputedPreview),
  refill: oc.input(ComputedRefillInput).output(z.object({ attributeId: Uuid })),
};
