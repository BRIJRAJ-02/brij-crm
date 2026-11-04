// What a visitor's browser sees of a form (spec 0023, 0023-experience.md, The
// visitor): the live document cut to what rendering needs (no attribute ids,
// filing, owner or routing), and the submit body and answer. The hosted page
// imports only the types from here (the Zod schemas stay on the server and in
// the app), so its bundle carries no schema library.
import * as z from 'zod';
import { ANSWER_TYPES } from './answer-types.ts';
import { FORM_LAYOUTS, FORM_LOOK_THEMES } from './path.ts';
import { CONDITION_OPS } from './show-when.ts';
import { Uuid } from '../values/ids.ts';
import { SubmitContext } from './context.ts';
import { PublicBrand } from '../workspace-brand.ts';
import { ResumedFill } from './partials.ts';
import { FILL_TICKET_MAX } from './ticket.ts';

export { FILL_TICKET_MAX };

/** The languages a hosted form speaks (spec 0023, value sourcing); English for anything missing. */
export const FORM_LANGUAGES = ['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'hi'] as const;
/** A hosted form's language. */
export type FormLanguage = (typeof FORM_LANGUAGES)[number];

/** A Show when as the visitor's page reads it. */
const PublicShowWhen = z.object({
  join: z.enum(['all', 'any']),
  rules: z.array(
    z.object({
      key: z.string(),
      op: z.enum(CONDITION_OPS),
      value: z.union([z.string(), z.array(z.string())]).optional(),
    }),
  ),
});

/** Where a jump sends a visitor, as the page reads it (spec 0063, AC-6313): a step further down, or an ending. */
export const PublicJump = z.object({
  when: PublicShowWhen.optional(),
  to: z.union([z.object({ step: z.string() }), z.object({ ending: z.string() })]),
});
/** Where a jump sends a visitor, as the page reads it. */
export type PublicJump = z.infer<typeof PublicJump>;

/**
 * One step as the visitor's page draws it (spec 0063): its questions by key, its title, its Show when and its
 * jumps. The page follows them so the visitor sees the step the server will agree they saw; the server works the
 * path out again from the stored answers and never takes the page's word for it (AC-6314).
 */
export const PublicStep = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  keys: z.array(z.string()),
  showWhen: PublicShowWhen.optional(),
  jumps: z.array(PublicJump).optional(),
});
/** One step as the visitor's page draws it. */
export type PublicStep = z.infer<typeof PublicStep>;

/** One question as the visitor's page renders it: its key (the input's name), label, type and choices. */
export const PublicQuestion = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  answerType: z.enum(ANSWER_TYPES),
  choices: z.array(z.string()).optional(),
  /** Each choice's stable key, in the choices' order: the option value a site's own form posts. */
  choiceKeys: z.array(z.string()).optional(),
  /** Shown only when earlier answers match (spec 0043, AC-1614): `visibleQuestions` decides, here and on the server. */
  showWhen: PublicShowWhen.optional(),
  placeholder: z.string().optional(),
  /** A quiet line under the question; absent when it has none. */
  description: z.string().optional(),
  required: z.boolean(),
  /** Its jumps (AC-6313), with One at a time, where each question is a screen of its own. */
  jumps: z.array(PublicJump).optional(),
  /**
   * What its answers are worth (AC-6316), sent only to a form whose own logic or words read the score, so a page
   * that never shows a score carries no points. The score the page works out is a convenience: the server adds the
   * stored answers up again and files only its own total.
   */
  points: z.union([z.array(z.number()), z.literal('value')]).optional(),
  /** What its type sets (spec 0063): a date's range, a scale's ends and words, a multi select's picks and Other. */
  options: z
    .object({
      earliest: z.string().optional(),
      latest: z.string().optional(),
      from: z.number().optional(),
      to: z.number().optional(),
      count: z.number().optional(),
      lowLabel: z.string().optional(),
      highLabel: z.string().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      other: z.boolean().optional(),
      default: z.string().optional(),
    })
    .optional(),
});
/** One question as the visitor's page renders it. */
export type PublicQuestion = z.infer<typeof PublicQuestion>;

/**
 * One ending as the visitor's page draws it (spec 0063, AC-6315): its heading, its line and an optional button to a
 * web address. An ending whose button books a meeting carries none here: that button is the booking hand off, which
 * only the server can sign, so it arrives with the submit's own next step.
 */
export const PublicEnding = z.object({
  id: z.string(),
  heading: z.string(),
  line: z.string().optional(),
  button: z.object({ url: z.string(), label: z.string() }).optional(),
});
/** One ending as the visitor's page draws it. */
export type PublicEnding = z.infer<typeof PublicEnding>;

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
  /**
   * Its look (spec 0063, AC-6327): Light or Dark, Rounded or Square, and whether it wears its workspace's brand
   * kit. `brand` arrives only with `theme: 'brand'`, so a plain form's read names no kit at all.
   */
  look: z.object({
    colour: z.enum(['light', 'dark']),
    corners: z.enum(['rounded', 'square']),
    theme: z.enum(FORM_LOOK_THEMES).optional(),
  }),
  questions: z.array(PublicQuestion),
  /** Classic when absent (spec 0063, AC-6302): Steps and One at a time load their own code on the page. */
  layout: z.enum(FORM_LAYOUTS).optional(),
  /** With Steps, the steps over `questions` (`stepsOf`); absent otherwise, since no other layout draws them. */
  steps: z.array(PublicStep).optional(),
  /** The endings beside the default thank you (AC-6315); absent on a form with none. */
  endings: z.array(PublicEnding).optional(),
  /** What the thank you says, when the form has its own words for it. */
  thanks: z.string().optional(),
  /** Whether the thank you offers a meeting (#59): false until booking pages exist. */
  offersMeeting: z.boolean(),
  recaptchaSiteKey: z.string().optional(),
  /**
   * The workspace's brand kit on this form (spec 0060, AC-4): the versions `brandStylesheetPath('forms', …)` and
   * `brandLogoPath('forms', …)` take. Absent when the form wears the product's own accent and no logo.
   */
  brand: PublicBrand.optional(),
  /**
   * Whether this form saves a visitor's progress (spec 0063, AC-6319), so the page knows whether to offer
   * Finish later at all. The server decides it (`savesProgress`), never the page.
   */
  savesProgress: z.boolean().optional(),
  /**
   * The answers and step a valid `?resume=` token opened (AC-6319). Absent when no token came, or when the one
   * that came was unknown, expired or another form's: a bad token is never an error, the form simply opens empty.
   */
  resumed: ResumedFill.optional(),
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
 * `GET /api/public/forms/:address/ticket` (and the booking page's
 * `/api/public/booking/:address/ticket`): a fill ticket, the server's signed
 * note of when the page loaded, for that address only. The page asks for one
 * when it loads (never cached) and sends it back with the submit as
 * `ticket`, so the minimum fill time is measured on the server's clock, not
 * the visitor's. A new one per "Send another"; one ticket is good for a few
 * submits within a day.
 */
export const FillTicket = z.object({ ticket: z.string().max(FILL_TICKET_MAX) });
/** A fill ticket. */
export type FillTicket = z.infer<typeof FillTicket>;

/**
 * `POST /api/public/forms/:address/submissions`. `idempotencyKey` is minted by
 * the page once per load and attempt (AC-555); `ticket` is the fill ticket the
 * page fetched when it loaded (the server's clock decides the fill time);
 * `fillMs` is the time from the page loading to the submit (advisory only,
 * used when no ticket came); `company_url`, the honeypot, must be empty.
 * Without a ticket or `fillMs` a submission is still taken, with a weaker
 * score. Answers are keyed by question key.
 */
export const SubmitBody = z.object({
  idempotencyKey: Uuid,
  versionNumber: z.number().int().min(1).optional(),
  answers: z.record(z.string().max(40), z.unknown()),
  hidden: SubmitHidden,
  captcha: z.string().max(4_096).optional(),
  company_url: z.string().max(1_000).optional(),
  ticket: z.string().max(FILL_TICKET_MAX).optional(),
  fillMs: z.number().int().min(0).max(86_400_000).optional(),
  /** Where it came from (the embed script or the hosted page): checked field by field, a bad one dropped, never the lead. */
  context: SubmitContext.optional(),
  /**
   * The resume token the page was holding (spec 0063, AC-6319), so the partial it names goes with the submit. An
   * unknown one deletes nothing and is never an error; it is never stored on the submission.
   */
  resumeToken: z.string().max(64).optional(),
});
/** The submit body. */
export type SubmitBody = z.input<typeof SubmitBody>;

/**
 * What the visitor gets next (AC-570, AC-1057): the thank you, where to go,
 * or the booking page to go on to after `countdownSeconds` (0: at once). The
 * booking `url` is same origin (`/b/<page>?p=<token>`), its token signed by
 * the server and holding the submission id and the page id only: nothing
 * personal rides in the link (the page asks the API for the name and email).
 */
export const SubmitNext = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('message'),
    text: z.string(),
    offersMeeting: z.boolean().optional(),
    /** The ending's heading, with its recalls already read (spec 0063, AC-6315, AC-6317); absent for the thank you. */
    heading: z.string().optional(),
    /** The ending's button: a web address and its words, both the server's own. */
    button: z.object({ url: z.string(), label: z.string() }).optional(),
    /** Which ending this is, for the page's own tests and nothing else. */
    ending: z.string().optional(),
  }),
  z.object({ kind: z.literal('redirect'), url: z.string() }),
  z.object({
    kind: z.literal('booking'),
    url: z.string(),
    countdownSeconds: z.number().int().min(0).max(30),
    /** The thank you's own words, shown above the countdown when the form has them. */
    text: z.string(),
  }),
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
