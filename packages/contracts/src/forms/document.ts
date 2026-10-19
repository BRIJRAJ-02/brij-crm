// The form document (spec 0023, `FormDocument`): one versioned JSON document
// per form version, holding its questions, blocks, targets, owner choice and
// what happens after a submit. Milestone 1's shape: one step, the main target
// only, an owner that is a fixed member or nobody, and a thank you message or
// a redirect after submitting. Later milestones widen the unions; a document
// saved now still parses then.
import * as z from 'zod';
import { FORM_QUESTION_TYPES, FORM_ONLY_TYPES, FORM_LANGUAGES } from './public.ts';

/** The most blocks one form holds. */
export const FORM_BLOCKS_MAX = 60;

/** The longest question label. */
export const FORM_LABEL_MAX = 200;

/** A block's id inside its document: short, lower case, stable across versions (a submission's answers key on it). */
export const BlockId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, { error: 'A block id is 1 to 40 lower case letters, digits, - or _.' });
/** A block's id inside its document. */
export type BlockId = z.infer<typeof BlockId>;

/** Where a question's answer goes: an attribute of the main record, or kept on the submission only. */
export const QuestionTarget = z.union([
  z.strictObject({ role: z.literal('main'), attributeId: z.uuid() }),
  z.strictObject({ formOnly: z.literal(true), type: z.enum(FORM_ONLY_TYPES) }),
]);
/** Where a question's answer goes. */
export type QuestionTarget = z.infer<typeof QuestionTarget>;

/** A question: an attribute of a target record (its one editor and its rules), or a form only question. */
export const QuestionBlock = z.strictObject({
  kind: z.literal('question'),
  id: BlockId,
  label: z
    .string()
    .trim()
    .min(1, { error: 'Give the question a label.' })
    .max(FORM_LABEL_MAX, { error: `Keep a label to ${String(FORM_LABEL_MAX)} characters.` }),
  help: z.string().trim().max(500, { error: 'Keep the help text to 500 characters.' }).optional(),
  required: z.boolean(),
  target: QuestionTarget,
  /** `fill` writes only an empty value (the default, AC-558); `always` overwrites. */
  update: z.enum(['fill', 'always']).default('fill'),
  /** The query parameter that prefills it on the hosted page (milestone 3 reads it). */
  prefillKey: z
    .string()
    .regex(/^[a-z0-9_]{1,40}$/)
    .optional(),
});
/** A question. */
export type QuestionBlock = z.infer<typeof QuestionBlock>;

const layoutText = z.string().trim().min(1).max(2_000, { error: 'Keep a text block to 2,000 characters.' });

/** A block of a step: a question, or a layout block (heading, text, divider). Consent blocks arrive with milestone 2. */
export const FormBlock = z.discriminatedUnion('kind', [
  QuestionBlock,
  z.strictObject({ kind: z.literal('heading'), id: BlockId, text: layoutText.max(200) }),
  z.strictObject({ kind: z.literal('text'), id: BlockId, text: layoutText }),
  z.strictObject({ kind: z.literal('divider'), id: BlockId }),
]);
/** A block of a step. */
export type FormBlock = z.infer<typeof FormBlock>;

/** One step of a form. Milestone 1 has exactly one; conditions (`showWhen`) arrive with milestone 2. */
export const FormStep = z.strictObject({
  id: BlockId,
  title: z.string().trim().max(200).optional(),
  blocks: z.array(FormBlock).max(FORM_BLOCKS_MAX, { error: `A form holds at most ${String(FORM_BLOCKS_MAX)} blocks.` }),
});
/** One step of a form. */
export type FormStep = z.infer<typeof FormStep>;

/** The records a submission writes: the main one, matched on its object's unique attribute (AC-557). */
export const FormTargets = z.strictObject({
  main: z.strictObject({ objectId: z.uuid(), matchAttributeId: z.uuid() }),
});
/** The records a submission writes. */
export type FormTargets = z.infer<typeof FormTargets>;

/**
 * Who owns a new main record (AC-567): a fixed member, or nobody. Round
 * robin (`{ kind: 'rotation' }`, #58) arrives with milestone 2.
 */
export const FormOwner = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('member'), memberId: z.uuid() }),
  z.strictObject({ kind: z.literal('none') }),
]);
/** Who owns a new main record. */
export type FormOwner = z.infer<typeof FormOwner>;

/** A redirect after submitting: an absolute https address (http only for localhost, for local testing). */
export const RedirectUrl = z
  .url({ error: 'Give a full address that starts with https://.' })
  .max(2_048)
  .refine(
    (value) => {
      const url = new URL(value);
      return url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost');
    },
    { error: 'Give a full address that starts with https://.' },
  );

/** What the visitor sees after submitting (AC-570): the thank you message, or a redirect. Booking (#59) arrives later. */
export const FormAfter = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('message'),
    text: z.string().trim().min(1, { error: 'Write the thank you message.' }).max(2_000),
  }),
  z.strictObject({ kind: z.literal('redirect'), url: RedirectUrl }),
]);
/** What the visitor sees after submitting. */
export type FormAfter = z.infer<typeof FormAfter>;

/** How the hosted page looks and reads. Colours, logo and indexing arrive with later milestones. */
export const FormStyle = z.strictObject({
  title: z.string().trim().min(1, { error: 'Give the form a title.' }).max(200),
  description: z.string().trim().max(2_000).optional(),
  buttonText: z.string().trim().min(1).max(40).default('Submit'),
  language: z.enum(FORM_LANGUAGES).default('en'),
});
/** How the hosted page looks and reads. */
export type FormStyle = z.infer<typeof FormStyle>;

/** The bot checks' settings (AC-583, AC-584). */
export const FormSpam = z.strictObject({
  minFillMs: z.number().int().min(0).max(60_000).default(2_500),
  scoreThreshold: z.number().min(0).max(1).default(0.3),
});
/** The bot checks' settings. */
export type FormSpam = z.infer<typeof FormSpam>;

/** One form version's whole document (spec 0023). */
export const FormDocument = z.strictObject({
  steps: z.array(FormStep).min(1).max(1, { error: 'Forms have one step for now.' }),
  targets: FormTargets,
  owner: FormOwner.default({ kind: 'none' }),
  after: FormAfter,
  style: FormStyle,
  spam: FormSpam.default({ minFillMs: 2_500, scoreThreshold: 0.3 }),
});
/** One form version's whole document. */
export type FormDocument = z.infer<typeof FormDocument>;
/** A document as written, before defaults fill in. */
export type FormDocumentInput = z.input<typeof FormDocument>;

/** Every question of a document, in order. */
export function questionsOf(document: Pick<FormDocument, 'steps'>): readonly QuestionBlock[] {
  return document.steps.flatMap((step) => step.blocks.flatMap((block) => (block.kind === 'question' ? [block] : [])));
}

/** The attribute types a question may map to (the public editors), re-exported for the builder. */
export { FORM_QUESTION_TYPES };
