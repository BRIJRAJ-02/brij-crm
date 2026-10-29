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
  CHOICE_TYPES,
  FORM_CHOICES_MAX,
  FORM_QUESTIONS_MAX,
  OPTION_KEY,
  QUESTION_KEY,
} from './answer-types.ts';
import { FORM_LANGUAGES } from './public.ts';
import { RoutingRules, ShowWhenSchema } from './routing.ts';
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
  /** Shown only when earlier answers match (spec 0043, AC-1614); absent, it always shows. */
  showWhen: ShowWhenSchema.optional(),
});
/** One question. */
export type FormQuestion = z.infer<typeof FormQuestion>;

/** How the page looks: two axes and nothing else, each mapped onto tokens, so no unreadable pair exists. */
export const FormLook = z.strictObject({
  colour: z.enum(['light', 'dark']).default('light'),
  corners: z.enum(['rounded', 'square']).default('rounded'),
});
/** How the page looks. */
export type FormLook = z.infer<typeof FormLook>;

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

/** The default headline. */
export const DEFAULT_HEADLINE = 'Fill this in and we will come back to you';

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
    }),
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
  })
  .superRefine((document, context) => {
    const seen = { ids: new Set<string>(), keys: new Set<string>(), attributes: new Set<string>() };
    let files = 0;
    document.questions.forEach((question, index) => {
      const at = ['questions', index];
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
      seen.ids.add(question.id);
      seen.keys.add(question.key);
      if (attributeId !== undefined) seen.attributes.add(attributeId);
    });
    if (files > 1) {
      context.addIssue({
        code: 'custom',
        path: ['questions'],
        message: 'A form can ask for one file. Remove the other file question first.',
      });
    }
  });
/** One form version's whole document. */
export type FormDocument = z.infer<typeof FormDocument>;
/** A document as written, before defaults fill in. */
export type FormDocumentInput = z.input<typeof FormDocument>;

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
