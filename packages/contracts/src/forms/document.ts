// The form document (spec 0023, 0023-experience.md, Contract changes): one
// versioned JSON document per form version. A form is a short list of
// questions, each with a plain answer type, filed onto an attribute of the
// form's target only where the member says so; then how the page looks, its
// words, and what follows a submit. A form with no target keeps its
// submissions only and files nothing (the owner's "what if I don't need to
// map", 21 October 2026). The form's name, address, owner and the sites that
// may post to it live on the form itself and apply at once.
import * as z from 'zod';
import {
  ANSWER_TYPES,
  CONSENT_PURPOSES,
  CHOICE_TYPES,
  FORM_CHOICES_MAX,
  FORM_QUESTIONS_MAX,
  OPTION_KEY,
  QUESTION_KEY,
  RATING_COUNT,
} from './answer-types.ts';
import { stepsOfBreaks, type ResolvedStep } from './breaks.ts';
import {
  DEFAULT_HEADLINE,
  FORM_ENDINGS_MAX,
  FORM_LAYOUTS,
  FORM_LOOK_THEMES,
  FORM_STEP_TITLE_MAX,
  STEP_JUMPS_MAX,
} from './path.ts';
import { POINTS_LIMIT, SCORED_TYPES } from './score.ts';
import { FORM_LANGUAGES } from './public.ts';
import { RoutingRules, ShowWhenSchema } from './routing.ts';
import {
  CLOSE_AFTER_MAX,
  CLOSED_MESSAGE_MAX,
  CONFIRMATION_LINE_MAX,
  CONFIRMATION_SUBJECT_MAX,
} from './confirmation.ts';
import { Uuid, uuidWith } from '../values/ids.ts';

/** A question's id inside its document: stable across versions, never shown. */
export const QuestionId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, { error: 'A question id is 1 to 40 lower case letters, digits, - or _.' });

/** A question's key: its input name and the key its answer is stored under. */
export const QuestionKey = z.string().regex(QUESTION_KEY, { error: 'Use lowercase letters, numbers and underscores.' });

/** A choice's key: the value a site's own form posts for it, kept when the choice is renamed. */
export const OptionKey = z
  .string()
  .regex(OPTION_KEY, { error: 'A choice key is 1 to 40 lowercase letters, numbers or underscores.' });

/** Where an answer is filed: an attribute of the form's main target (later milestones add person, company, deal). */
export const FiledOn = z.strictObject({ objectRole: z.literal('main'), attributeId: Uuid });
/** Where an answer is filed. */
export type FiledOn = z.infer<typeof FiledOn>;

/** A scale's ends: 0 or 1 to 5, 7 or 10 (spec 0063, AC-6307; 0 to 10 is NPS). */
export const SCALE_FROM = [0, 1] as const;
/** A scale's top. */
export const SCALE_TO = [5, 7, 10] as const;

/**
 * What a question's type may set beyond its choices (spec 0063, AC-6307), each read only by its type: a date's
 * earliest and latest day; a scale's ends and their words; a multi select's least and most picks and its Other box;
 * a hidden question's value when the link brings none.
 */
export const FormQuestionOptions = z.strictObject({
  earliest: z.iso.date({ error: 'Give the earliest day as a date.' }).optional(),
  latest: z.iso.date({ error: 'Give the latest day as a date.' }).optional(),
  from: z.union([z.literal(0), z.literal(1)]).optional(),
  to: z.union([z.literal(5), z.literal(7), z.literal(10)]).optional(),
  /** A rating's number of stars, 3 to 10; 5 when absent. Its ends' words are `lowLabel` and `highLabel`, as a scale's. */
  count: z
    .number()
    .int()
    .min(RATING_COUNT.min, { error: 'Use at least 3 stars.' })
    .max(RATING_COUNT.max, { error: 'Use at most 10 stars.' })
    .optional(),
  lowLabel: z.string().trim().max(40, { error: 'Keep an end’s words to 40 characters.' }).optional(),
  highLabel: z.string().trim().max(40, { error: 'Keep an end’s words to 40 characters.' }).optional(),
  min: z.number().int().min(1).max(FORM_CHOICES_MAX).optional(),
  max: z.number().int().min(1).max(FORM_CHOICES_MAX).optional(),
  other: z.boolean().optional(),
  default: z.string().trim().max(200, { error: 'Keep the value to 200 characters.' }).optional(),
  /** A consent's purpose (AC-1053); absent reads as `marketing_email`. */
  purpose: z.enum(CONSENT_PURPOSES).optional(),
  /**
   * A consent's wording version (AC-1053): 1 when first published, and one more each time it is published with
   * different words, so every consent record names the exact words its person agreed to. Publish sets it; the
   * builder never does.
   */
  wordingVersion: z.number().int().min(1).max(1_000_000).optional(),
});
/** What a question's type may set beyond its choices. */
export type FormQuestionOptions = z.infer<typeof FormQuestionOptions>;

/** A step's id inside its document: stable across versions, never shown. */
export const StepId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, { error: 'A step id is 1 to 40 lower case letters, digits, - or _.' });

/** A redirect after submitting: an absolute https address (http only for localhost, for local testing). */
export const RedirectUrl = z
  .url({ error: 'Give a full address that starts with https://.' })
  .max(2_048)
  .refine(
    (value) => {
      // Zod 4 runs this even after `.url()` has refused the value, so a partial address ("https://") must not
      // throw here: a throw turned a field's refusal into a 500, which the builder showed as a lost connection.
      if (!URL.canParse(value)) return false;
      const url = new URL(value);
      return url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost');
    },
    { error: 'Give a full address that starts with https://.' },
  );

/** An ending's id inside its document: stable across versions, never shown. */
export const EndingId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, { error: 'An ending id is 1 to 40 lower case letters, digits, - or _.' });

/**
 * One ending beside the default thank you (spec 0063, AC-6315): a heading, one line, and an optional button, which
 * goes to a web address or on to a booking page. A jump or a routing rule names it; otherwise the form's own After
 * someone sends it decides, as it always has. Its heading and line may recall an earlier answer or the score.
 */
export const FormEnding = z.strictObject({
  id: EndingId,
  heading: z.string().trim().max(120, { error: 'Keep an ending’s heading to 120 characters.' }),
  line: z.string().trim().max(2_000, { error: 'Keep an ending’s line to 2,000 characters.' }).optional(),
  button: z
    .discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('url'),
        url: RedirectUrl,
        label: z.string().trim().max(40, { error: 'Keep the button text to 40 characters.' }).optional(),
      }),
      z.strictObject({
        kind: z.literal('booking'),
        bookingPageId: uuidWith('Pick a booking page.'),
        label: z.string().trim().max(40, { error: 'Keep the button text to 40 characters.' }).optional(),
      }),
    ])
    .optional(),
});
/** One ending beside the default thank you. */
export type FormEnding = z.infer<typeof FormEnding>;

/** Where a jump sends a visitor (AC-6313): a step further down the form, or one of its endings. */
export const JumpTarget = z.union([z.strictObject({ step: StepId }), z.strictObject({ ending: EndingId })]);
/** Where a jump sends a visitor. */
export type JumpTarget = z.infer<typeof JumpTarget>;

/**
 * One jump on a step (AC-6313): when the answers so far match, go there. A step's jumps are tried in order and the
 * first match decides; no match goes to the next step. Jumps only go forward, which publish refuses a document for
 * breaking (`publishProblem`) and `walkPath` ignores at run time, so a visitor can never loop.
 */
export const FormJump = z.strictObject({ when: ShowWhenSchema, to: JumpTarget });
/** One jump on a step. */
export type FormJump = z.infer<typeof FormJump>;

/**
 * What a question's answers are worth (spec 0063, AC-6316): one whole number per choice, in the order of
 * `choices` (a choice question, a multi select, and a yes or no, whose two numbers are yes then no); for a rating
 * and a scale, one per point it offers, lowest first, or `'value'` for the answer itself.
 */
export const FormQuestionPoints = z.union([
  z
    .array(
      z
        .number()
        .int({ error: 'Give points as a whole number.' })
        .min(-POINTS_LIMIT, { error: `Keep points between -${String(POINTS_LIMIT)} and ${String(POINTS_LIMIT)}.` })
        .max(POINTS_LIMIT, { error: `Keep points between -${String(POINTS_LIMIT)} and ${String(POINTS_LIMIT)}.` }),
    )
    .max(FORM_CHOICES_MAX, { error: 'A question scores at most one number per choice.' }),
  z.literal('value'),
]);
/** What a question's answers are worth. */
export type FormQuestionPoints = z.infer<typeof FormQuestionPoints>;

/** One question. A draft may hold an empty label; publishing refuses it (`publishProblem`). */
export const FormQuestion = z.strictObject({
  id: QuestionId,
  key: QuestionKey,
  label: z.string().trim().max(200, { error: 'Keep a question to 200 characters.' }),
  answerType: z.enum(ANSWER_TYPES),
  /** Only for the choice types; kept when the type changes, so switching back loses nothing. */
  choices: z
    .array(z.string().trim().max(80, { error: 'Keep a choice to 80 characters.' }))
    .max(FORM_CHOICES_MAX, { error: `A question holds at most ${String(FORM_CHOICES_MAX)} choices.` })
    .optional(),
  /**
   * Each choice's stable key, in the same order as `choices` (one per choice):
   * the option value a site's own form posts, so renaming a choice never breaks
   * a site. Absent on questions saved before keys existed; `choiceKeysOf` makes
   * them from the words until the builder stores them.
   */
  choiceKeys: z.array(OptionKey).max(FORM_CHOICES_MAX).optional(),
  placeholder: z.string().trim().max(80, { error: 'Keep a placeholder to 80 characters.' }).optional(),
  /**
   * A quiet line under the question (5 November 2026, Typeform's and Tally's description): what it means or why it
   * is asked. Absent on every question saved before it existed; empty while the builder has it open and unwritten.
   */
  description: z.string().trim().max(280, { error: 'Keep a description to 280 characters.' }).optional(),
  required: z.boolean(),
  /** Absent: not filed, kept with the enquiry. */
  filedOn: FiledOn.optional(),
  /**
   * The person chose to keep this answer off the CRM: an unfiled question that is not given a field of its own on
   * Save or Publish, nor filed again by its label when the object changes. Without it an unfiled, labelled question
   * gets a new field, so "Not filed" could never be chosen and every booking question became a People column
   * (28 October 2026). Meaningless beside `filedOn`, which a filing clears it for.
   */
  kept: z.literal(true).optional(),
  /** `fill` writes only an empty value (the default, AC-558); `always` overwrites. */
  update: z.enum(['fill', 'always']).default('fill'),
  /**
   * The form's How did you hear about us question (spec 0067, AC-6703): its answers show beside Insights' sources.
   * A choice, dropdown or short text question, one a form.
   */
  source: z.literal(true).optional(),
  /** Shown only when earlier answers match (spec 0043, AC-1614); absent, it always shows. */
  showWhen: ShowWhenSchema.optional(),
  /** What its type sets beyond its choices (spec 0063): a date's range, a scale's ends, a hidden value's default. */
  options: FormQuestionOptions.optional(),
  /** What its answers are worth towards the form's score (spec 0063, AC-6316); absent, it scores nothing. */
  points: FormQuestionPoints.optional(),
  /**
   * Where this question sends a visitor when their answer matches (AC-6313), in order. Drawn only by One at a time,
   * where each question is a screen of its own; Steps carries its jumps on the step divider, and Classic, which
   * shows every question at once, has nowhere to jump from.
   */
  jumps: z
    .array(FormJump)
    .max(STEP_JUMPS_MAX, { error: `Use at most ${String(STEP_JUMPS_MAX)} jumps on one question.` })
    .optional(),
});
/** One question. */
export type FormQuestion = z.infer<typeof FormQuestion>;

/**
 * A break in the questions (spec 0063, AC-6303): a new step starts at `startsAt`, the id of its first question, with
 * an optional title and Show when. Absent `startsAt` puts it after the last question, which leaves it empty until a
 * question follows it. Breaks are kept with every layout and drawn only by Steps.
 */
export const FormStep = z.strictObject({
  id: StepId,
  title: z
    .string()
    .trim()
    .max(FORM_STEP_TITLE_MAX, { error: `Keep a step’s title to ${String(FORM_STEP_TITLE_MAX)} characters.` })
    .optional(),
  startsAt: QuestionId.optional(),
  /** Shown only when earlier answers match (AC-6312); absent, it always shows. */
  showWhen: ShowWhenSchema.optional(),
  /** Where this step sends a visitor when their answers match (AC-6313), in order; no match goes to the next step. */
  jumps: z
    .array(FormJump)
    .max(STEP_JUMPS_MAX, { error: `Use at most ${String(STEP_JUMPS_MAX)} jumps on one step.` })
    .optional(),
});
/** A break in the questions. */
export type FormStep = z.infer<typeof FormStep>;

/**
 * How the page looks: three axes and nothing else, each mapped onto tokens, so no unreadable pair exists. `theme`
 * (spec 0063, AC-6327) says whether it wears the workspace's brand kit. It is absent on every document written
 * before this spec, and absent reads as `plain` everywhere, so those forms keep exactly the look they had; a new
 * form is made with `brand` (`defaultDocument` in `@crm/core`).
 */
export const FormLook = z.strictObject({
  colour: z.enum(['light', 'dark']).default('light'),
  corners: z.enum(['rounded', 'square']).default('rounded'),
  theme: z.enum(FORM_LOOK_THEMES).optional(),
});
/** How the page looks. */
export type FormLook = z.infer<typeof FormLook>;

/** The countdown before a visitor goes on to book (AC-1056): 5 seconds unless set, 0 for at once, at most 30. */
export const BOOKING_COUNTDOWN = { default: 5, min: 0, max: 30 } as const;

/** Seconds before the visitor goes on to the booking page; 0 sends them at once. */
export const BookingCountdown = z
  .number()
  .int({ error: 'Give the countdown in whole seconds.' })
  .min(BOOKING_COUNTDOWN.min, { error: 'The countdown can’t be negative.' })
  .max(BOOKING_COUNTDOWN.max, { error: `Keep the countdown to ${String(BOOKING_COUNTDOWN.max)} seconds.` });

/**
 * What follows a submit (AC-570, AC-1055): the thank you, a redirect, or on
 * to one of the workspace's booking pages after a short countdown, with the
 * visitor's name and email filled in there. `message` on `booking` is the
 * thank you shown when the page is paused or gone at send time.
 * `offerMeeting` on `message` is the old, never shown offer, kept so older
 * documents still read.
 */
export const FormAfter = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('message'),
    message: z.string().trim().max(2_000, { error: 'Keep the message to 2,000 characters.' }).default(''),
    offerMeeting: z.strictObject({ bookingPageId: Uuid }).optional(),
  }),
  z.strictObject({ kind: z.literal('redirect'), url: RedirectUrl }),
  z.strictObject({
    kind: z.literal('booking'),
    bookingPageId: uuidWith('Pick a booking page.'),
    countdownSeconds: BookingCountdown.default(BOOKING_COUNTDOWN.default),
    message: z.string().trim().max(2_000, { error: 'Keep the message to 2,000 characters.' }).default(''),
  }),
]);
/** What follows a submit. */
export type FormAfter = z.infer<typeof FormAfter>;

/** The bot checks' settings: the minimum fill time and, when reCAPTCHA is on, the score below which it is spam. */
export const FormSpam = z.strictObject({
  minFillMs: z.number().int().min(0).max(60_000).default(2_000),
  scoreThreshold: z.number().min(0).max(1).default(0.3),
});
/** The bot checks' settings. */
export type FormSpam = z.infer<typeof FormSpam>;

export {
  CLOSE_AFTER_MAX,
  CLOSED_MESSAGE_MAX,
  CONFIRMATION_LINE_MAX,
  CONFIRMATION_SUBJECT_MAX,
} from './confirmation.ts';

/**
 * The visitor's confirmation email (spec 0063, AC-6318): off by default. When
 * on, one goes per accepted submission to the form's email answer, with this
 * subject and line, or the template's defaults when they are left out. It
 * never goes for a spam or held submission.
 */
export const FormConfirmation = z.strictObject({
  on: z.boolean().default(false),
  subject: z
    .string()
    .trim()
    .max(CONFIRMATION_SUBJECT_MAX, { error: `Keep the subject to ${String(CONFIRMATION_SUBJECT_MAX)} characters.` })
    .optional(),
  line: z
    .string()
    .trim()
    .max(CONFIRMATION_LINE_MAX, { error: `Keep the line to ${String(CONFIRMATION_LINE_MAX)} characters.` })
    .optional(),
});
/** The visitor's confirmation email. */
export type FormConfirmation = z.infer<typeof FormConfirmation>;

/** Below this many questions a Classic form saves no progress unless its owner asks (AC-6319). */
export const SAVE_PROGRESS_CLASSIC_MIN = 10;

/** The default button text. */
export const DEFAULT_BUTTON_TEXT = 'Send';

/** One form version's whole document (spec 0023, 0023-experience.md). */
export const FormDocument = z
  .strictObject({
    questions: z
      .array(FormQuestion)
      .max(FORM_QUESTIONS_MAX, { error: `A form holds at most ${String(FORM_QUESTIONS_MAX)} questions.` }),
    /** Where submissions go in the CRM: `main` is the object each one adds or updates. Absent, they stay in Submissions only. */
    targets: z.strictObject({
      main: z.strictObject({ objectId: Uuid, matchAttributeId: Uuid.optional() }).optional(),
      /**
       * Also create a deal (forms fix a3, 5 November 2026): with People as `main`, each submission also makes a
       * record on this object (the standard Deals), named after the person and linked to them and their company.
       * Absent on every document written before it, which makes no deal.
       */
      deal: z.strictObject({ objectId: Uuid }).optional(),
    }),
    /**
     * Where each question was saved on an object the form moved away from (forms fix a2, 5 November 2026): by
     * object id, each question's attribute there. Moving back puts them back, so trying another object never loses
     * a mapping for good. Only the server writes it (`setFormTarget`); it never reaches a visitor.
     */
    filedBefore: z
      .record(Uuid, z.record(z.string().max(64), Uuid))
      .refine((objects) => Object.keys(objects).length <= 50, { error: 'Too many remembered objects.' })
      .optional(),
    /** Classic, Steps or One at a time (spec 0063, AC-6302): in the version, so a visitor mid fill never sees it change. */
    layout: z.enum(FORM_LAYOUTS).default('classic'),
    /** The breaks between steps, in the questions' order. Drawn only by Steps. */
    steps: z
      .array(FormStep)
      .max(FORM_QUESTIONS_MAX, { error: `A form holds at most ${String(FORM_QUESTIONS_MAX)} steps.` })
      .default([]),
    /**
     * The endings beside the default thank you (spec 0063, AC-6315); a jump or a routing rule names one. Absent on
     * a form with none, as every document written before this spec: `endingsOf` reads absent and empty alike, so
     * no stored document and no fixture has to carry an empty list.
     */
    endings: z
      .array(FormEnding)
      .max(FORM_ENDINGS_MAX, { error: `A form holds at most ${String(FORM_ENDINGS_MAX)} endings beside the default.` })
      .optional(),
    /** Where the form's score is filed (spec 0063, AC-6316): a number attribute, for example a lead score. */
    scoreFiledOn: FiledOn.optional(),
    look: FormLook.default({ colour: 'light', corners: 'rounded' }),
    headline: z.string().trim().max(120, { error: 'Keep the headline to 120 characters.' }).default(DEFAULT_HEADLINE),
    subheading: z.string().trim().max(240, { error: 'Keep the subheading to 240 characters.' }).optional(),
    buttonText: z
      .string()
      .trim()
      .min(1, { error: 'Give the button some text.' })
      .max(40, { error: 'Keep the button text to 40 characters.' })
      .default(DEFAULT_BUTTON_TEXT),
    language: z.enum(FORM_LANGUAGES).default('en'),
    after: FormAfter.default({ kind: 'message', message: '' }),
    /** Routing rules (spec 0043, AC-1604): tried in order at submit; none matching means `after`. */
    routing: RoutingRules.default({ rules: [] }),
    spam: FormSpam.default({ minFillMs: 2_000, scoreThreshold: 0.3 }),
    /**
     * The visitor's copy of what they sent (spec 0063, AC-6318): off until someone turns it on. Absent on every
     * document written before this spec, and read through `sendsConfirmation`, so no stored document and no
     * fixture has to carry it.
     */
    confirmation: FormConfirmation.optional(),
    /**
     * Whether a part filled form is saved so the visitor can finish it later (AC-6319). Absent on every document
     * written before this spec, which `savesProgress` reads as the layout's own default: on for Steps and One at a
     * time, off for Classic until it grows past `SAVE_PROGRESS_CLASSIC_MIN` questions.
     */
    saveProgress: z.boolean().optional(),
    /**
     * When it stops taking answers by itself (forms fix b2, 5 November 2026): at a moment, after a number of
     * answers (spam left out), or both, whichever comes first. Absent: only Pause closes it.
     */
    closing: z
      .strictObject({
        at: z.iso.datetime({ offset: true }).optional(),
        after: z
          .number()
          .int({ error: 'Give a whole number of answers.' })
          .min(1, { error: 'Close after at least one answer.' })
          .max(CLOSE_AFTER_MAX)
          .optional(),
      })
      .optional(),
    /** What a closed form (paused, or past `closing`) says to a visitor; the language's own line when absent. */
    closedMessage: z
      .string()
      .trim()
      .max(CLOSED_MESSAGE_MAX, { error: `Keep the message to ${String(CLOSED_MESSAGE_MAX)} characters.` })
      .optional(),
  })
  .superRefine((document, context) => {
    if (document.targets.deal !== undefined && document.targets.main === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['targets', 'deal'],
        message: 'A deal is made beside the person. Save submissions to People first.',
      });
    }
    const seen = { ids: new Set<string>(), keys: new Set<string>(), attributes: new Set<string>() };
    let files = 0;
    let signatures = 0;
    let sources = 0;
    document.questions.forEach((question, index) => {
      const at = ['questions', index];
      if (question.source === true) {
        sources += 1;
        if (!['choice', 'dropdown', 'short_text'].includes(question.answerType)) {
          context.addIssue({
            code: 'custom',
            path: [...at, 'source'],
            message: 'Only a choice or short answer question can ask how they heard about you.',
          });
        }
        if (sources > 1) {
          context.addIssue({
            code: 'custom',
            path: [...at, 'source'],
            message: 'One question per form asks how they heard about you.',
          });
        }
      }
      if (seen.ids.has(question.id))
        context.addIssue({ code: 'custom', path: [...at, 'id'], message: 'Two questions share one id.' });
      if (seen.keys.has(question.key)) {
        context.addIssue({
          code: 'custom',
          path: [...at, 'key'],
          message: 'Two questions use the same key.',
        });
      }
      if (question.choiceKeys !== undefined) {
        if (question.choiceKeys.length !== (question.choices ?? []).length) {
          context.addIssue({
            code: 'custom',
            path: [...at, 'choiceKeys'],
            message: 'Each choice needs exactly one key.',
          });
        } else if (new Set(question.choiceKeys).size !== question.choiceKeys.length) {
          context.addIssue({ code: 'custom', path: [...at, 'choiceKeys'], message: 'Two choices share one key.' });
        }
      }
      const attributeId = question.filedOn?.attributeId;
      if (attributeId !== undefined && document.targets.main === undefined) {
        context.addIssue({
          code: 'custom',
          path: [...at, 'filedOn'],
          message: 'A form that keeps submissions only files no answers. Add submissions to the CRM first.',
        });
      }
      if (attributeId !== undefined && seen.attributes.has(attributeId)) {
        context.addIssue({
          code: 'custom',
          path: [...at, 'filedOn'],
          message: 'Two questions are filed on one attribute.',
        });
      }
      if (question.answerType === 'file') files += 1;
      if (question.answerType === 'signature') signatures += 1;
      seen.ids.add(question.id);
      seen.keys.add(question.key);
      if (attributeId !== undefined) seen.attributes.add(attributeId);
    });
    const at = new Map(document.questions.map((question, index) => [question.id, index]));
    const stepIds = new Set<string>();
    let last = 0;
    document.steps.forEach((step, index) => {
      const path = ['steps', index];
      if (stepIds.has(step.id))
        context.addIssue({ code: 'custom', path: [...path, 'id'], message: 'Two steps share one id.' });
      stepIds.add(step.id);
      const place = step.startsAt === undefined ? document.questions.length : at.get(step.startsAt);
      if (place === undefined) {
        context.addIssue({
          code: 'custom',
          path: [...path, 'startsAt'],
          message: 'A step starts at a question that is no longer on the form.',
        });
        return;
      }
      if (place < last) {
        context.addIssue({ code: 'custom', path: [...path, 'startsAt'], message: 'The steps are out of order.' });
      }
      last = Math.max(last, place);
    });
    document.questions.forEach((question, index) => {
      const { options } = question;
      if (options === undefined) return;
      const at = ['questions', index, 'options'];
      if (options.earliest !== undefined && options.latest !== undefined && options.earliest > options.latest) {
        context.addIssue({
          code: 'custom',
          path: [...at, 'latest'],
          message: 'The latest day comes before the earliest.',
        });
      }
      if (options.min !== undefined && options.max !== undefined && options.min > options.max) {
        context.addIssue({ code: 'custom', path: [...at, 'max'], message: 'The most picks is fewer than the least.' });
      }
    });
    // Points (spec 0063, AC-6316): only the types that carry them, and one number per thing they offer.
    document.questions.forEach((question, index) => {
      const { points } = question;
      if (points === undefined) return;
      const where = ['questions', index, 'points'];
      if (!SCORED_TYPES.includes(question.answerType)) {
        context.addIssue({ code: 'custom', path: where, message: 'This kind of answer can’t carry points.' });
        return;
      }
      if (points === 'value') {
        if (question.answerType !== 'rating' && question.answerType !== 'scale') {
          context.addIssue({
            code: 'custom',
            path: where,
            message: 'Only a rating or a scale can score the answer itself.',
          });
        }
        return;
      }
      const offered =
        question.answerType === 'yes_no'
          ? 2
          : question.answerType === 'rating'
            ? 5
            : question.answerType === 'scale'
              ? (question.options?.to ?? 10) - (question.options?.from ?? 0) + 1
              : (question.choices ?? []).length;
      if (points.length > offered) {
        context.addIssue({
          code: 'custom',
          path: where,
          message: 'There are more points here than there are answers.',
        });
      }
    });
    // Endings (AC-6315): one id each, and a heading apiece, since a visitor lands on one.
    const endingIds = new Set<string>();
    (document.endings ?? []).forEach((ending, index) => {
      if (endingIds.has(ending.id)) {
        context.addIssue({ code: 'custom', path: ['endings', index, 'id'], message: 'Two endings share one id.' });
      }
      endingIds.add(ending.id);
    });
    // A jump's target, a recall's key and a backward jump are publish's refusals, in one sentence each
    // (`publishProblem`, AC-6326): a draft stays savable while a question or an ending is being moved or removed,
    // and the member is told what to put right when they go to publish.
    if (files > 1) {
      context.addIssue({
        code: 'custom',
        path: ['questions'],
        message: 'A form can ask for one file. Remove the other file question first.',
      });
    }
    if (signatures > 1) {
      context.addIssue({
        code: 'custom',
        path: ['questions'],
        message: 'A form can ask for one signature. Remove the other signature question first.',
      });
    }
  });
/** One form version's whole document. */
export type FormDocument = z.infer<typeof FormDocument>;
/** A document as written, before defaults fill in. */
export type FormDocumentInput = z.input<typeof FormDocument>;

/** A document's steps over its questions (`stepsOfBreaks`), keyed by question key: what the hosted page groups. */
export function stepsOf(document: Pick<FormDocument, 'questions' | 'steps'>): ResolvedStep<FormStep['showWhen']>[] {
  return stepsOfBreaks(document.questions, document.steps);
}

/** True when a question's answer is picked from its own choices. */
export function isChoiceQuestion(question: Pick<FormQuestion, 'answerType'>): boolean {
  return CHOICE_TYPES.includes(question.answerType);
}

/** The questions of a new form: Name, Email and Phone (AC-649), with the email filed on the match attribute when known. */
export function defaultQuestions(filing: {
  readonly nameAttributeId?: string;
  readonly emailAttributeId?: string;
  readonly phoneAttributeId?: string;
}): FormQuestion[] {
  const filed = (attributeId: string | undefined) =>
    attributeId === undefined ? {} : { filedOn: { objectRole: 'main' as const, attributeId } };
  return [
    {
      id: 'name',
      key: 'name',
      label: 'Your name',
      answerType: 'short_text',
      placeholder: 'John Doe',
      required: true,
      update: 'fill',
      ...filed(filing.nameAttributeId),
    },
    {
      id: 'email',
      key: 'email',
      label: 'Work email',
      answerType: 'email',
      placeholder: 'john@acme.com',
      required: true,
      update: 'fill',
      ...filed(filing.emailAttributeId),
    },
    {
      id: 'phone',
      key: 'phone',
      label: 'Phone or WhatsApp',
      answerType: 'phone',
      placeholder: '555 000 1234',
      required: false,
      update: 'fill',
      ...filed(filing.phoneAttributeId),
    },
  ];
}

/**
 * Whether a form saves a visitor's progress as they go (AC-6319): what its
 * owner set, else the layout's own default — Steps and One at a time always
 * do, since each Continue is a natural moment to save, and Classic does only
 * once it is long enough to be worth coming back to.
 */
/** Whether a form emails the visitor their own copy (AC-6318): absent reads as off, as every older document is. */
export function sendsConfirmation(document: Pick<FormDocument, 'confirmation'>): boolean {
  return document.confirmation?.on === true;
}

export function savesProgress(document: Pick<FormDocument, 'layout' | 'questions' | 'saveProgress'>): boolean {
  if (document.saveProgress !== undefined) return document.saveProgress;
  if (document.layout !== 'classic') return true;
  return document.questions.length > SAVE_PROGRESS_CLASSIC_MIN;
}

/**
 * Whether a form's own closing rule has closed it (forms fix b2): its moment has passed, or it holds as many
 * answers as it closes after. `answers` is the form's count of stored submissions, spam left out. Pure.
 */
export function closedByRule(
  document: Pick<FormDocument, 'closing'>,
  input: { readonly now: Date; readonly answers: number },
): boolean {
  const closing = document.closing;
  if (closing === undefined) return false;
  if (closing.at !== undefined && Date.parse(closing.at) <= input.now.getTime()) return true;
  return closing.after !== undefined && input.answers >= closing.after;
}
