// What a visitor's browser sees of a form (spec 0023, 0023-public-surface.md):
// the live document cut to what rendering needs (no attribute ids, mappings,
// owner or routing), and the submit body and answer. `@crm/contracts/forms`
// exports this with the shared answer check, with no oRPC, for the hosted page.
import * as z from 'zod';
import type { AttributeType } from '../values/attribute-values.ts';
import { Hue } from '../values/hues.ts';

/** The attribute types a question can map to in milestone 1: those with a public editor. */
export const FORM_QUESTION_TYPES = [
  'text',
  'long_text',
  'number',
  'date',
  'checkbox',
  'select',
  'rating',
  'email',
  'domain',
  'url',
  'personal_name',
] as const satisfies readonly AttributeType[];
/** An attribute type a question can map to. */
export type FormQuestionType = (typeof FORM_QUESTION_TYPES)[number];

/** The types a form only question can take (no options to define, so no select). */
export const FORM_ONLY_TYPES = [
  'text',
  'long_text',
  'number',
  'date',
  'checkbox',
  'rating',
  'email',
  'url',
] as const satisfies readonly FormQuestionType[];

/** The languages a hosted form speaks (spec 0023, value sourcing); English for anything missing. */
export const FORM_LANGUAGES = ['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'hi'] as const;
/** A hosted form's language. */
export type FormLanguage = (typeof FORM_LANGUAGES)[number];

/** True when `type` has a public editor. */
export function isFormQuestionType(type: string): type is FormQuestionType {
  return (FORM_QUESTION_TYPES as readonly string[]).includes(type);
}

/** One rule a question carries to the browser, keyed by its question id (never the attribute's). */
export const PublicRule = z.object({
  id: z.string(),
  kind: z.string(),
  params: z.record(z.string(), z.unknown()),
  message: z.string().optional(),
  position: z.number().int(),
});
/** One rule a question carries to the browser. */
export type PublicRule = z.infer<typeof PublicRule>;

/** One question as the browser renders it: its id in the form, its type, its options and its rules. */
export const PublicQuestion = z.object({
  kind: z.literal('question'),
  id: z.string(),
  label: z.string(),
  help: z.string().optional(),
  required: z.boolean(),
  type: z.enum(FORM_QUESTION_TYPES),
  isMulti: z.boolean(),
  options: z.array(z.object({ id: z.uuid(), label: z.string(), hue: Hue.optional() })).optional(),
  prefillKey: z.string().optional(),
  rules: z.array(PublicRule).optional(),
});
/** One question as the browser renders it. */
export type PublicQuestion = z.infer<typeof PublicQuestion>;

/** One block as the browser renders it. */
export const PublicBlock = z.discriminatedUnion('kind', [
  PublicQuestion,
  z.object({ kind: z.literal('heading'), id: z.string(), text: z.string() }),
  z.object({ kind: z.literal('text'), id: z.string(), text: z.string() }),
  z.object({ kind: z.literal('divider'), id: z.string() }),
]);
/** One block as the browser renders it. */
export type PublicBlock = z.infer<typeof PublicBlock>;

/**
 * `GET /api/public/forms/:publicKey`: a live form as its hosted page renders
 * it, with the version it answers and the reCAPTCHA site key when bot checks
 * are on. A paused form answers `status: 'paused'` and nothing to render.
 */
export const PublicForm = z.object({
  key: z.string(),
  status: z.enum(['live', 'paused']),
  versionNumber: z.number().int().min(1),
  title: z.string(),
  description: z.string().optional(),
  buttonText: z.string(),
  language: z.enum(FORM_LANGUAGES),
  steps: z.array(z.object({ id: z.string(), title: z.string().optional(), blocks: z.array(PublicBlock) })),
  /** Whether the search engines may index it: always false in milestone 1 (AC-587). */
  indexing: z.boolean(),
  recaptchaSiteKey: z.string().optional(),
  /** Set when the form is paused: the "not taking responses" message (AC-549). */
  closedMessage: z.string().optional(),
});
/** A form as its hosted page renders it. */
export type PublicForm = z.infer<typeof PublicForm>;

/** The largest submit body the endpoint reads (0023-public-surface.md). */
export const SUBMIT_BODY_MAX_BYTES = 64 * 1024;

/** UTM tags, the page and the referrer (AC-591), each short. Unknown keys are dropped. */
export const SubmitHidden = z
  .object({
    utm_source: z.string().max(200).optional(),
    utm_medium: z.string().max(200).optional(),
    utm_campaign: z.string().max(200).optional(),
    utm_term: z.string().max(200).optional(),
    utm_content: z.string().max(200).optional(),
    page: z.string().max(2_048).optional(),
    referrer: z.string().max(2_048).optional(),
  })
  .default({});
/** UTM tags, the page and the referrer. */
export type SubmitHidden = z.infer<typeof SubmitHidden>;

/**
 * `POST /api/public/forms/:publicKey/submissions`. `idempotencyKey` is minted
 * by the browser once per attempt (AC-555); `startedAt` is advisory only (the
 * visitor's clock), used for the minimum fill time; `honeypot` must be empty.
 */
export const SubmitBody = z.object({
  idempotencyKey: z.uuid(),
  versionNumber: z.number().int().min(1),
  answers: z.record(z.string().max(40), z.unknown()),
  hidden: SubmitHidden,
  captcha: z.string().max(4_096).optional(),
  honeypot: z.string().max(1_000).optional(),
  /** Milliseconds from the first interaction to the submit, as the browser measured it. */
  fillMs: z.number().int().min(0).max(86_400_000).optional(),
});
/** The submit body. */
export type SubmitBody = z.input<typeof SubmitBody>;

/** What the visitor gets next (AC-570): the thank you message, or where to go. */
export const SubmitNext = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('message'), text: z.string() }),
  z.object({ kind: z.literal('redirect'), url: z.string() }),
]);
/** What the visitor gets next. */
export type SubmitNext = z.infer<typeof SubmitNext>;

/** A stored submission's answer: the next step only. Never whether the email already existed. */
export const SubmitResult = z.object({ next: SubmitNext });
/** A stored submission's answer. */
export type SubmitResult = z.infer<typeof SubmitResult>;

/** A refused submission's field errors (422 `ANSWERS_INVALID`), by question id, in the form's language. */
export const SubmitErrors = z.object({
  code: z.string(),
  message: z.string(),
  fields: z.record(z.string(), z.string()).optional(),
});
/** A refused submission's answer. */
export type SubmitErrors = z.infer<typeof SubmitErrors>;
