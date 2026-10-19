// What a visitor's browser sees of a form (spec 0023, 0023-experience.md, The
// visitor): the live document cut to what rendering needs (no attribute ids,
// filing, owner or routing), and the submit body and answer. The hosted page
// imports only the types from here (the Zod schemas stay on the server and in
// the app), so its bundle carries no schema library.
import * as z from 'zod';
import { ANSWER_TYPES } from './answer-types.ts';

/** The languages a hosted form speaks (spec 0023, value sourcing); English for anything missing. */
export const FORM_LANGUAGES = ['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'hi'] as const;
/** A hosted form's language. */
export type FormLanguage = (typeof FORM_LANGUAGES)[number];

/** One question as the visitor's page renders it: its key (the input's name), label, type and choices. */
export const PublicQuestion = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  answerType: z.enum(ANSWER_TYPES),
  choices: z.array(z.string()).optional(),
  placeholder: z.string().optional(),
  required: z.boolean(),
});
/** One question as the visitor's page renders it. */
export type PublicQuestion = z.infer<typeof PublicQuestion>;

/**
 * `GET /api/public/forms/:address`: a form as its hosted page renders it. A
 * paused form answers `status: 'paused'` and no questions. `preview` marks
 * the builder's rendering of a draft, which never sends.
 */
export const PublicForm = z.object({
  key: z.string(),
  status: z.enum(['live', 'paused']),
  versionNumber: z.number().int().min(1),
  headline: z.string(),
  subheading: z.string().optional(),
  buttonText: z.string(),
  language: z.enum(FORM_LANGUAGES),
  look: z.object({ colour: z.enum(['light', 'dark']), corners: z.enum(['rounded', 'square']) }),
  questions: z.array(PublicQuestion),
  /** What the thank you says, when the form has its own words for it. */
  thanks: z.string().optional(),
  /** Whether the thank you offers a meeting (#59): false until booking pages exist. */
  offersMeeting: z.boolean(),
  recaptchaSiteKey: z.string().optional(),
});
/** A form as its hosted page renders it. */
export type PublicForm = z.infer<typeof PublicForm>;

/** The largest submit body the endpoint reads. */
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
 * `POST /api/public/forms/:address/submissions`. `idempotencyKey` is minted by
 * the page once per load and attempt (AC-555); `fillMs` is the time from the
 * page loading to the submit (advisory only); `company_url`, the honeypot,
 * must be empty. Answers are keyed by question key.
 */
export const SubmitBody = z.object({
  idempotencyKey: z.uuid(),
  versionNumber: z.number().int().min(1).optional(),
  answers: z.record(z.string().max(40), z.unknown()),
  hidden: SubmitHidden,
  captcha: z.string().max(4_096).optional(),
  company_url: z.string().max(1_000).optional(),
  fillMs: z.number().int().min(0).max(86_400_000).optional(),
});
/** The submit body. */
export type SubmitBody = z.input<typeof SubmitBody>;

/** What the visitor gets next (AC-570): the thank you, or where to go. */
export const SubmitNext = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('message'), text: z.string(), offersMeeting: z.boolean().optional() }),
  z.object({ kind: z.literal('redirect'), url: z.string() }),
]);
/** What the visitor gets next. */
export type SubmitNext = z.infer<typeof SubmitNext>;

/** A stored submission's answer: the next step only. Never whether the email already existed. */
export const SubmitResult = z.object({ next: SubmitNext });
/** A stored submission's answer. */
export type SubmitResult = z.infer<typeof SubmitResult>;

/** A refused submission's answer: a code, a sentence, and field errors by question key (422). */
export const SubmitErrors = z.object({
  code: z.string(),
  message: z.string(),
  fields: z.record(z.string(), z.string()).optional(),
});
/** A refused submission's answer. */
export type SubmitErrors = z.infer<typeof SubmitErrors>;
