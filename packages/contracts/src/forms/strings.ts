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
  readonly preferNot: string;
  readonly closed: string;
  readonly notFoundTitle: string;
  readonly notFound: string;
  readonly tooMany: string;
  readonly failed: string;
  readonly offline: string;
  readonly thanksTitle: string;
  readonly thanks: string;
  readonly thanksMeeting: string;
  readonly bookMeeting: string;
  readonly sendAnother: string;
  readonly searchCountries: string;
  readonly noCountries: string;
  readonly dialCode: string;
  readonly fileLater: string;
  readonly previewNote: string;
  readonly recaptchaNotice: string;
  readonly honeypot: string;
  /** A question with no label yet, in the builder's preview. */
  readonly untitledQuestion: string;
  /** Under every form until branding removal arrives as a plan flag (AC-577). */
  readonly madeWith: string;
  /** The dial code picker's name with the country picked: "Country code, United States". */
  readonly dialCodeOf: (country: string) => string;
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
  optional: 'optional',
  sending: 'Sending…',
  chooseOne: 'Choose one',
  preferNot: 'Prefer not to say',
  closed: 'This form isn’t taking enquiries right now.',
  notFoundTitle: 'Form not found',
  notFound: 'This form doesn’t exist, or its address changed.',
  tooMany: 'That did not go through. Try again in a moment.',
  failed: 'That did not go through. Try again in a moment.',
  offline: 'That did not go through. Check your connection and try again.',
  thanksTitle: 'Thank you. That is with us.',
  thanks: 'We will come back to you at the address you gave.',
  thanksMeeting: 'We will come back to you at the address you gave, or book a time now and skip the wait.',
  bookMeeting: 'Book a quick meeting',
  sendAnother: 'Send another',
  searchCountries: 'Search countries',
  noCountries: 'No country by that name.',
  dialCode: 'Country code',
  fileLater: 'File uploads arrive soon.',
  previewNote: 'A preview of the form. It can’t be filled in here.',
  recaptchaNotice: 'This form is protected by reCAPTCHA. Google’s Privacy Policy and Terms of Service apply.',
  honeypot: 'Leave this empty',
  untitledQuestion: 'Untitled question',
  madeWith: 'Made with Timefix',
  dialCodeOf: (country) => `Country code, ${country}`,
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
