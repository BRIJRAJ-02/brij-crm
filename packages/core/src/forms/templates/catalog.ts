// The form templates themselves (spec 0063, AC-6323, AC-6324): twelve ready
// forms, in code and versioned with `FORM_TEMPLATES_VERSION`, never in the
// database, so a template is read the same on every deployment and a change
// to one is a reviewed commit.
//
// A template is deliberately not a `FormDocument`. It says what to ask and,
// for each answer, the *slug* of the standard attribute it belongs on
// (`filesOnto`); `draftOf` turns that into a document against one workspace's
// own schema, because two workspaces' People have the same slugs but
// different attribute ids, and a workspace may have renamed, archived or
// never had a field. An answer whose slug matches nothing is kept with the
// submission instead (`kept`), and no field is made for it until publish.
//
// Every template asks for a name and an email filed on People, because a form
// whose answers reach the CRM needs both: the email is how a submission finds
// the record it belongs to, and a name is required on People, so a template
// without them could never be published (`publishProblem`).
import type {
  AnswerType,
  FormLayout,
  FormQuestionOptions,
  FormQuestionPoints,
  FormTemplateId,
  FormTemplatePreviewRow,
} from '@crm/contracts';

/** The templates' version, moved whenever a template's questions change, so a report can say which one made a form. */
export const FORM_TEMPLATES_VERSION = 3;

/** One question a template asks, before it knows a workspace's attribute ids. */
export interface FormTemplateQuestion {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly answerType: AnswerType;
  readonly required: boolean;
  readonly placeholder?: string;
  readonly choices?: readonly string[];
  readonly options?: FormQuestionOptions;
  /**
   * The `apiSlug` of the standard attribute this answer belongs on, when the
   * workspace's target object has one of a type that fits. Absent, or matching
   * nothing, means the answer is kept with the submission and files nowhere.
   */
  readonly filesOnto?: string;
  /**
   * What each answer is worth, for a template that scores (spec 0063, AC-6316): one whole number per choice, in
   * the order of `choices`. The form's score is the sum; where it is filed is the member's own call, since no
   * workspace is guaranteed a number attribute to file it on.
   */
  readonly points?: FormQuestionPoints;
  /** Starts a new step here (`FormStep`), for a template whose layout is Steps. */
  readonly step?: { readonly id: string; readonly title: string };
}

/** One template: what the tile says, what the form looks like, and what it asks. */
export interface FormTemplate {
  readonly id: FormTemplateId;
  /** The tile's name in the gallery: what the person is choosing between. */
  readonly name: string;
  /**
   * What the form it makes is called, when that isn't the tile's own name. The blank tile is "Blank form", because
   * that is the choice; the form it makes is "Untitled form", because that is what an unnamed form is called
   * everywhere else in the product (UX review, slice 8).
   */
  readonly formName?: string;
  /** Why you would pick it, in one line (AC-6323). */
  readonly purpose: string;
  /** The tile's small preview of its look (AC-6323): the shapes of its first few answers. */
  readonly preview: readonly FormTemplatePreviewRow[];
  readonly layout: FormLayout;
  readonly headline: string;
  /** What the form's thank you page says (critique c: each template thanks for its own job, not one line for all). */
  readonly thanks: string;
  readonly buttonText: string;
  readonly questions: readonly FormTemplateQuestion[];
  /**
   * Whether the form goes on to a booking page after it is sent (AC-6323's "ends with Book a meeting"). The page is
   * resolved when the draft is made; with none the maker can use, the form thanks the visitor instead.
   */
  readonly endsWithBooking?: true;
}

/** Name and email, which every template starts with: the two answers a submission needs to become a person. */
const WHO: readonly FormTemplateQuestion[] = [
  {
    id: 'name',
    key: 'name',
    label: 'Your name',
    answerType: 'short_text',
    placeholder: 'John Doe',
    required: true,
    filesOnto: 'name',
  },
  {
    id: 'email',
    key: 'email',
    label: 'Work email',
    answerType: 'email',
    placeholder: 'john@acme.com',
    required: true,
    filesOnto: 'email_addresses',
  },
];

/**
 * Name and a personal email, for a form a person fills in for themselves rather than for their work (critique c:
 * an event, a job, a newsletter or feedback never asks for a work email).
 */
const PERSON: readonly FormTemplateQuestion[] = WHO.map((question) =>
  question.answerType === 'email' ? { ...question, label: 'Email', placeholder: 'you@example.com' } : question,
);

const PHONE: FormTemplateQuestion = {
  id: 'phone',
  key: 'phone',
  label: 'Phone or WhatsApp',
  answerType: 'phone',
  placeholder: '555 000 1234',
  required: false,
  filesOnto: 'phone_numbers',
};

/** The company a person works at, kept with the submission: People holds its company as a link, not as text. */
const COMPANY: FormTemplateQuestion = {
  id: 'company',
  key: 'company',
  label: 'Company',
  answerType: 'short_text',
  placeholder: 'Acme',
  required: false,
};

const JOB_TITLE: FormTemplateQuestion = {
  id: 'job_title',
  key: 'job_title',
  label: 'Job title',
  answerType: 'short_text',
  placeholder: 'Head of sales',
  required: false,
  filesOnto: 'job_title',
};

/**
 * A long open answer. `filesOnto` is deliberately absent, so it is kept with the submission rather than written
 * onto the person: People · Description is the only standard long text a visitor could fill, and it is a durable,
 * purpose-neutral field that anyone with People read sees and that exports, search, webhooks and the API all carry.
 * A support form's "What is happening?", a feedback form's "What could be better?" and an NPS "why" are none of
 * them a person's description, and the first complaint somebody files should not become their permanent one
 * (security review, slice 8). `intro` is the exception, for the templates where a short line about the person
 * genuinely is a description.
 */
const note = (id: string, key: string, label: string, placeholder: string): FormTemplateQuestion => ({
  id,
  key,
  label,
  answerType: 'long_text',
  placeholder,
  required: false,
});

/** A long answer that really is about the person, filed on People · Description where the workspace has it. */
const intro = (id: string, key: string, label: string, placeholder: string): FormTemplateQuestion => ({
  ...note(id, key, label, placeholder),
  filesOnto: 'description',
});

/** Every template that exists in code, by id: the gallery offers each of them (`OFFERED_FORM_TEMPLATE_IDS`). */
export const FORM_TEMPLATES: Readonly<Record<FormTemplateId, FormTemplate>> = {
  blank: {
    id: 'blank',
    name: 'Blank form',
    // The same name `createForm` gives an unnamed form: the blank tile makes exactly what New form used to.
    formName: 'Untitled form',
    purpose: 'Name, email and phone.',
    preview: ['field', 'field', 'field'],
    layout: 'classic',
    headline: 'Fill this in and we will come back to you',
    thanks: 'Thanks. We will come back to you soon.',
    buttonText: 'Send',
    questions: [...WHO, PHONE],
  },

  contact_us: {
    id: 'contact_us',
    name: 'Contact us',
    purpose: 'Name, email and a message.',
    preview: ['field', 'field', 'long'],
    layout: 'classic',
    headline: 'Talk to us',
    thanks: 'Thanks for getting in touch. We will reply within one working day.',
    buttonText: 'Send message',
    questions: [...WHO, COMPANY, intro('message', 'message', 'How can we help?', 'Tell us what you need')],
  },

  demo_request: {
    id: 'demo_request',
    name: 'Demo request',
    purpose: 'Role, company and what to show.',
    preview: ['field', 'field', 'long'],
    layout: 'classic',
    headline: 'Book a demo',
    thanks: 'Thanks. We will be in touch to find a time for your demo.',
    buttonText: 'Request a demo',
    questions: [
      ...WHO,
      COMPANY,
      JOB_TITLE,
      intro('goal', 'goal', 'What would you like to see?', 'The part of your work we should start with'),
    ],
  },

  event_signup: {
    id: 'event_signup',
    name: 'Event signup',
    purpose: 'Who’s coming, and which sessions.',
    preview: ['field', 'field', 'date'],
    layout: 'classic',
    headline: 'Save your seat',
    thanks: 'You’re in. We will email the details before the day.',
    buttonText: 'Sign me up',
    questions: [
      ...PERSON,
      {
        id: 'day',
        key: 'day',
        label: 'Which day suits you?',
        answerType: 'date',
        required: true,
      },
      {
        id: 'sessions',
        key: 'sessions',
        label: 'Which sessions interest you?',
        answerType: 'multi_select',
        required: false,
        choices: ['Opening keynote', 'Workshops', 'Panel', 'Dinner'],
        options: { other: true },
      },
      {
        id: 'guest',
        key: 'guest',
        label: 'Bringing a guest?',
        answerType: 'yes_no',
        required: false,
      },
    ],
  },

  feedback: {
    id: 'feedback',
    name: 'Feedback',
    purpose: 'A rating, and why.',
    preview: ['field', 'rating', 'long'],
    layout: 'classic',
    headline: 'How did we do?',
    thanks: 'Thank you. Every answer is read.',
    buttonText: 'Send feedback',
    questions: [
      ...PERSON,
      {
        id: 'rating',
        key: 'rating',
        label: 'How was it?',
        answerType: 'rating',
        required: true,
      },
      note('better', 'better', 'What could be better?', 'Anything at all'),
    ],
  },

  nps: {
    id: 'nps',
    name: 'Recommendation score (NPS)',
    purpose: '0 to 10, and why.',
    preview: ['field', 'scale', 'long'],
    layout: 'classic',
    headline: 'How likely are you to recommend us?',
    thanks: 'Thank you. That helps more than you know.',
    buttonText: 'Send',
    questions: [
      ...PERSON,
      {
        id: 'nps',
        key: 'nps',
        label: 'How likely are you to recommend us to a colleague?',
        answerType: 'scale',
        required: true,
        options: { from: 0, to: 10, lowLabel: 'Not likely', highLabel: 'Very likely' },
      },
      note('why', 'why', 'What made you pick that number?', 'The one thing that decided it'),
    ],
  },

  job_application: {
    id: 'job_application',
    name: 'Job application',
    purpose: 'Role, CV and portfolio.',
    preview: ['field', 'choices', 'upload'],
    layout: 'classic',
    headline: 'Apply to join us',
    thanks: 'Thanks for applying. We read every application and will reply either way.',
    buttonText: 'Send application',
    questions: [
      ...PERSON,
      PHONE,
      {
        id: 'role',
        key: 'role',
        label: 'Which role?',
        answerType: 'choice',
        required: true,
        choices: ['Engineering', 'Design', 'Sales', 'Support', 'Something else'],
      },
      {
        id: 'portfolio',
        key: 'portfolio',
        label: 'A link to your work',
        answerType: 'website',
        placeholder: 'https://',
        required: false,
      },
      {
        id: 'cv',
        key: 'cv',
        label: 'Your CV',
        answerType: 'file',
        required: false,
      },
      // A person applying hands over their details: they agree to how they are kept (spec 0023, AC-1053).
      {
        id: 'privacy',
        key: 'privacy',
        label: 'I agree to my details being kept to consider my application.',
        answerType: 'consent',
        required: true,
        options: { purpose: 'terms' },
      },
    ],
  },

  newsletter: {
    id: 'newsletter',
    name: 'Newsletter',
    purpose: 'Email and consent.',
    preview: ['field', 'field'],
    layout: 'classic',
    headline: 'Get the monthly note',
    thanks: 'You’re subscribed. The next note arrives at the start of the month.',
    buttonText: 'Subscribe',
    // Marketing email needs the person's say so, in words they saw (spec 0023, AC-1053).
    questions: [
      ...PERSON,
      {
        id: 'marketing',
        key: 'marketing',
        label: 'Send me the monthly note. I can unsubscribe at any time.',
        answerType: 'consent',
        required: true,
        options: { purpose: 'marketing_email' },
      },
    ],
  },

  support_request: {
    id: 'support_request',
    name: 'Support request',
    purpose: 'What broke, and how urgent.',
    preview: ['field', 'long', 'choices'],
    layout: 'classic',
    headline: 'Tell us what went wrong',
    thanks: 'Got it. We are on it and will reply by email.',
    buttonText: 'Send request',
    questions: [
      ...WHO,
      note('problem', 'problem', 'What is happening?', 'What you did, and what happened instead'),
      {
        id: 'urgency',
        key: 'urgency',
        label: 'How urgent is it?',
        answerType: 'choice',
        required: true,
        choices: ['I can’t work at all', 'It’s slowing me down', 'A small annoyance'],
      },
      {
        id: 'screenshot',
        key: 'screenshot',
        label: 'A screenshot, if you have one',
        answerType: 'file',
        required: false,
      },
    ],
  },

  customer_onboarding: {
    id: 'customer_onboarding',
    name: 'Customer onboarding',
    purpose: 'Details, a step at a time.',
    preview: ['field', 'field', 'field'],
    layout: 'steps',
    headline: 'Welcome aboard',
    thanks: 'All set. We will be in touch with your next steps.',
    buttonText: 'Finish setup',
    questions: [
      ...WHO,
      PHONE,
      { ...JOB_TITLE, step: { id: 'work', title: 'Where you work' } },
      COMPANY,
      {
        id: 'address',
        key: 'address',
        label: 'Billing address',
        answerType: 'address',
        required: false,
        filesOnto: 'primary_location',
        step: { id: 'billing', title: 'Billing' },
      },
      {
        id: 'heard',
        key: 'heard',
        label: 'How did you hear about us?',
        answerType: 'choice',
        required: false,
        choices: ['A colleague', 'Search', 'Social', 'An event', 'Somewhere else'],
      },
    ],
  },

  // Held out of the gallery until slice 5 (see `OFFERED_FORM_TEMPLATE_IDS`). The questions are the right ones; what
  // is missing is the points on each choice and the `scoreFiledOn` that make it a *scored* qualification form
  // (AC-6316). Without those it is a longer Demo request, which is why it isn't offered yet.
  lead_qualification: {
    id: 'lead_qualification',
    name: 'Lead qualification',
    purpose: 'Budget, timeline and team size.',
    preview: ['field', 'choices', 'choices'],
    layout: 'classic',
    headline: 'Tell us about your team',
    thanks: 'Thanks. We will be in touch with what fits your team.',
    buttonText: 'Send',
    questions: [
      ...WHO,
      COMPANY,
      JOB_TITLE,
      {
        id: 'budget',
        key: 'budget',
        label: 'What budget do you have in mind?',
        answerType: 'choice',
        required: true,
        choices: ['Under $1k', '$1k to $10k', '$10k to $50k', 'Over $50k'],
        points: [0, 10, 25, 40],
      },
      {
        id: 'timeline',
        key: 'timeline',
        label: 'When would you like to start?',
        answerType: 'choice',
        required: true,
        choices: ['This month', 'This quarter', 'This year', 'Just looking'],
        points: [30, 20, 5, 0],
      },
      {
        id: 'team_size',
        key: 'team_size',
        label: 'How many people would use it?',
        answerType: 'choice',
        required: false,
        choices: ['Just me', '2 to 10', '11 to 50', 'More than 50'],
        points: [0, 5, 15, 30],
      },
    ],
  },

  // Ends with Book a meeting (AC-6323): after the visitor sends it, they move on to a booking page with their name
  // and email filled in. Which page is the workspace's, so the draft resolves it (`createFormFromTemplate`).
  booking_intake: {
    id: 'booking_intake',
    name: 'Booking intake',
    purpose: 'A few questions, then your calendar.',
    preview: ['field', 'field', 'long'],
    layout: 'classic',
    headline: 'Before we meet',
    thanks: 'Thanks. We look forward to meeting you.',
    buttonText: 'Continue',
    endsWithBooking: true,
    questions: [...WHO, COMPANY, note('agenda', 'agenda', 'What would you like to cover?', 'So we can come prepared')],
  },
};
