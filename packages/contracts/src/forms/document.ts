// The form document (spec 0023, 0023-experience.md, Contract changes): one
// versioned JSON document per form version. A form is a short list of
// questions, each with a plain answer type, filed onto an attribute of the
// form's target only where the member says so; then how the page looks, its
// words, and what follows a submit. The form's name, address, owner and the
// sites that may post to it live on the form itself and apply at once.
import * as z from 'zod';
import { ANSWER_TYPES, CHOICE_TYPES, FORM_CHOICES_MAX, FORM_QUESTIONS_MAX, QUESTION_KEY } from './answer-types.ts';
import { FORM_LANGUAGES } from './public.ts';

/** A question's id inside its document: stable across versions, never shown. */
export const QuestionId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, { error: 'A question id is 1 to 40 lower case letters, digits, - or _.' });

/** A question's key: its input name and the key its answer is stored under. */
export const QuestionKey = z.string().regex(QUESTION_KEY, { error: 'Use lowercase letters, numbers and underscores.' });

/** Where an answer is filed: an attribute of the form's main target (later milestones add person, company, deal). */
export const FiledOn = z.strictObject({ objectRole: z.literal('main'), attributeId: z.uuid() });
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
  placeholder: z.string().trim().max(80, { error: 'Keep a placeholder to 80 characters.' }).optional(),
  required: z.boolean(),
  /** Absent: not filed, kept with the enquiry. */
  filedOn: FiledOn.optional(),
  /** `fill` writes only an empty value (the default, AC-558); `always` overwrites. */
  update: z.enum(['fill', 'always']).default('fill'),
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
      const url = new URL(value);
      return url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost');
    },
    { error: 'Give a full address that starts with https://.' },
  );

/**
 * What follows a submit (AC-570): the thank you, optionally offering a meeting
 * on a booking page (#59, hidden until booking pages exist), or a redirect.
 */
export const FormAfter = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('message'),
    message: z.string().trim().max(2_000).default(''),
    offerMeeting: z.strictObject({ bookingPageId: z.uuid() }).optional(),
  }),
  z.strictObject({ kind: z.literal('redirect'), url: RedirectUrl }),
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
    targets: z.strictObject({
      main: z.strictObject({ objectId: z.uuid(), matchAttributeId: z.uuid().optional() }),
    }),
    look: FormLook.default({ colour: 'light', corners: 'rounded' }),
    headline: z.string().trim().max(120).default(DEFAULT_HEADLINE),
    subheading: z.string().trim().max(240).optional(),
    buttonText: z.string().trim().min(1, { error: 'Give the button some text.' }).max(40).default(DEFAULT_BUTTON_TEXT),
    language: z.enum(FORM_LANGUAGES).default('en'),
    after: FormAfter.default({ kind: 'message', message: '' }),
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
          message: `Two questions both use the key “${question.key}”.`,
        });
      }
      const attributeId = question.filedOn?.attributeId;
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
