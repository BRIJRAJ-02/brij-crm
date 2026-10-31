// The visitor's words (spec 0023, 0023-experience.md, The visitor): one
// catalogue per language, English for anything a language leaves out. Plain
// TypeScript, no Zod: the hosted page loads it.
import type { FormLanguage } from './public.ts';

/** Every message the hosted page and the answer check word themselves. */
export interface FormStrings {
  readonly required: string;
  readonly requiredCheckbox: string;
  readonly pickOption: string;
  readonly email: string;
  readonly phone: string;
  readonly website: string;
  readonly number: string;
  readonly tooLong: string;
  readonly country: string;
  readonly optional: string;
  readonly sending: string;
  readonly chooseOne: string;
  readonly closed: string;
  /** Read out while the form itself is still being fetched, so the loading page says what it is waiting for. */
  readonly loading: string;
  readonly notFoundTitle: string;
  readonly notFound: string;
  readonly tooMany: string;
  readonly failed: string;
  readonly offline: string;
  /** A refusal naming a question this page never drew: the form was published again while it was filled in. */
  readonly changed: string;
  /** The same, once the page drew the new version in place with the answers kept. */
  readonly updated: string;
  readonly thanksTitle: string;
  readonly thanks: string;
  /** The thank you's line when the form asked for no email or phone, so there is no address to come back to. */
  readonly thanksNeutral: string;
  readonly thanksMeeting: string;
  readonly bookMeeting: string;
  readonly sendAnother: string;
  readonly searchCountries: string;
  readonly noCountries: string;
  readonly dialCode: string;
  /** A file answer the server can't match to an upload: said under the file question. */
  readonly fileInvalid: string;
  /** The file question's drop area: what it asks for. */
  readonly fileChoose: string;
  /** Under a file question in the builder's preview, where the drop area is drawn but off (27 October 2026). */
  readonly filePreview: string;
  /** Said politely once a file is in, and once one is taken off. */
  readonly fileUploaded: (name: string) => string;
  readonly fileRemoved: (name: string) => string;
  /** Under the button while a file is still going: the form waits for it. */
  readonly fileBusy: string;
  /** Said under the file question when an upload failed. */
  readonly fileFailed: string;
  readonly previewNote: string;
  readonly recaptchaNotice: string;
  readonly honeypot: string;
  /** Said to a screen reader when an answer shows more questions, or hides some (spec 0043). */
  readonly questionsShown: string;
  readonly questionsHidden: string;
  /** A question with no label yet, in the builder's preview. */
  readonly untitledQuestion: string;
  /**
   * Under every form until branding removal arrives as a plan flag (AC-577): "Powered by" over the Timefix mark, as
   * on a link page and a booking page (spec 0060, AC-19), and the mark's name.
   */
  readonly poweredBy: string;
  readonly product: string;
  /** The dial code picker's name with the country picked: "Country code, United States". */
  readonly dialCodeOf: (country: string) => string;
  /** Above the button after a submit that found problems: "2 answers need a look". */
  readonly needsALook: (count: number) => string;
  /** Under an email that looks like a common provider misspelt. */
  readonly didYouMean: (email: string) => string;
  /** The button that takes the suggested address. */
  readonly useSuggestion: string;
  /** Over the countdown to the booking page, read once: "Taking you to book a time in 5 seconds." */
  readonly bookingIn: (seconds: number) => string;
  /** The countdown's line with its number drawn apart: the words before and after it. */
  readonly bookingInBefore: string;
  readonly bookingInAfter: string;
  /** Going on to the booking page at once (a countdown of 0). */
  readonly bookingNow: string;
  /** Goes to the booking page now. */
  readonly bookNow: string;
  /** Stops the countdown and stays on the thank you. */
  readonly stayHere: string;
  /** After Stay here: the way to the booking page, for later. */
  readonly bookATime: string;
  /** A step form's place: "Step 2 of 3". */
  readonly stepOf: (step: number, steps: number) => string;
  /** A one at a time form's place, for screen readers: "2 of 7" (AC-1034). */
  readonly questionOf: (question: number, questions: number) => string;
  /** Back to the previous step. */
  readonly back: string;
  /** On to the next step. */
  readonly next: string;
  /** On to the next question, in a one at a time form. */
  readonly ok: string;
}

const EN: FormStrings = {
  required: 'Answer this question.',
  requiredCheckbox: 'Tick this to go on.',
  pickOption: 'Pick one of the choices.',
  email: 'Enter an email address, such as ada@example.com.',
  phone: 'Enter a phone number, digits only after the code.',
  website: 'Enter a web address, such as acme.com.',
  number: 'Enter a number, such as 1500.',
  tooLong: 'That is longer than this question takes.',
  country: 'Pick a country from the list.',
  optional: '(optional)',
  sending: 'Sending…',
  chooseOne: 'Choose one',
  closed: 'This form isn’t taking enquiries right now.',
  loading: 'Loading the form…',
  notFoundTitle: 'Form not found',
  notFound: 'This form doesn’t exist, or its address changed.',
  tooMany: 'That did not go through. Try again in a moment.',
  failed: 'That did not go through. Try again in a moment.',
  offline: 'That did not go through. Check your connection and try again.',
  changed: 'This form changed while you were filling it in. Copy your answers first, then reload the page.',
  updated:
    'This form was updated while you filled it in. Your answers are kept. Answer any new questions and send again.',
  thanksTitle: 'Thank you. That is with us.',
  thanks: 'We will come back to you at the address you gave.',
  thanksNeutral: 'We have it, and the team will read it shortly.',
  thanksMeeting: 'We will come back to you at the address you gave, or book a time now and skip the wait.',
  bookMeeting: 'Book a quick meeting',
  sendAnother: 'Send another',
  searchCountries: 'Search countries',
  noCountries: 'No country by that name.',
  dialCode: 'Country code',
  fileInvalid: 'Upload the file again.',
  fileChoose: 'Choose a file',
  filePreview: 'Visitors choose their file here once the form is published. The preview doesn’t take one.',
  fileUploaded: (name) => `${name} uploaded.`,
  fileRemoved: (name) => `${name} removed.`,
  fileBusy: 'Wait for the file to finish uploading, then send.',
  fileFailed: 'That file did not upload. Try again, or choose another file.',
  previewNote: 'A preview of the form. It can’t be filled in here.',
  recaptchaNotice: 'This form is protected by reCAPTCHA. Google’s Privacy Policy and Terms of Service apply.',
  honeypot: 'Leave this empty',
  questionsShown: 'Your answer added a question below.',
  questionsHidden: 'Your answer removed a question that no longer applies.',
  untitledQuestion: 'Untitled question',
  poweredBy: 'Powered by',
  product: 'Timefix',
  dialCodeOf: (country) => `Country code, ${country}`,
  needsALook: (count) => (count === 1 ? '1 answer needs a look' : `${String(count)} answers need a look`),
  didYouMean: (email) => `Did you mean ${email}?`,
  useSuggestion: 'Use it',
  bookingIn: (seconds) => `Taking you to book a time in ${String(seconds)} ${seconds === 1 ? 'second' : 'seconds'}.`,
  bookingInBefore: 'Taking you to book a time in',
  bookingInAfter: '…',
  bookingNow: 'Taking you to book a time…',
  bookNow: 'Book now',
  stayHere: 'Stay here',
  bookATime: 'Book a time',
  stepOf: (step, steps) => `Step ${String(step)} of ${String(steps)}`,
  questionOf: (question, questions) => `${String(question)} of ${String(questions)}`,
  back: 'Back',
  next: 'Continue',
  ok: 'OK',
};

const CATALOGUE: Readonly<Record<FormLanguage, Partial<FormStrings>>> = {
  en: EN,
  es: {},
  fr: {},
  de: {},
  pt: {},
  it: {},
  nl: {},
  hi: {},
};

/** The hosted page's words in `language`, English for anything missing. */
export function formStrings(language: FormLanguage): FormStrings {
  return { ...EN, ...CATALOGUE[language] };
}
