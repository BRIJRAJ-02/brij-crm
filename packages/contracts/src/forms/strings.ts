// The hosted page's own words (spec 0023, value sourcing): one catalogue per
// language, English for anything a language leaves out. Milestone 1 ships
// English; the other languages fill in later without code changes.
import type { FormLanguage } from './public.ts';

/** Every message the hosted page and the submit endpoint word themselves. */
export interface FormStrings {
  readonly required: string;
  readonly requiredCheckbox: string;
  readonly pickOption: string;
  readonly sending: string;
  readonly closed: string;
  readonly notFound: string;
  readonly tooMany: string;
  readonly failed: string;
  readonly fixErrors: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly ratingOf: string;
  readonly optional: string;
  readonly yes: string;
  readonly recaptchaNotice: string;
}

const EN: FormStrings = {
  required: 'Answer this question.',
  requiredCheckbox: 'Tick this to go on.',
  pickOption: 'Pick one of the options.',
  sending: 'Sending…',
  closed: 'This form is not taking responses right now.',
  notFound: 'This form does not exist.',
  tooMany: 'Too many submissions in a short time. Wait a minute and try again.',
  failed: 'Something went wrong. Try again.',
  fixErrors: 'Some answers need a look.',
  firstName: 'First name',
  lastName: 'Last name',
  ratingOf: 'stars',
  optional: 'optional',
  yes: 'Yes',
  recaptchaNotice: 'This form is protected by reCAPTCHA. Google’s Privacy Policy and Terms of Service apply.',
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
