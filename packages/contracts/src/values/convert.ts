// Changing an attribute's type in place, the safe subset (the field types pass, 31 October 2026): how one value of
// the old type becomes one of the new, for the pairs `TYPE_CHANGES` allows. Pure, over the value schemas, so the
// engine's check and its write convert alike. A phone parser is injected: libphonenumber-js is large, and only
// the server's one wrapper loads it.
import { EmailValue, LongTextValue, NumberValue, TextValue, UrlValue } from './attribute-values.ts';
import { CURRENCY_CODES } from './currencies.ts';
import { isTypeChange } from './type-changes.ts';

/** Phone parsing, injected: a valid number in E.164 with its country, or undefined. */
export interface ConvertPhoneParser {
  readonly parse: (
    text: string,
    defaultCountry?: string,
  ) => { readonly number: string; readonly country: string } | undefined;
}

/** What converting a value may need: the new currency's code, a phone parser and the country numbers default to. */
export interface ConvertContext {
  readonly defaultCurrency?: string | undefined;
  readonly defaultCountry?: string | undefined;
  readonly phone?: ConvertPhoneParser | undefined;
}

/** One value after a change: kept as it was, written in its new form, or impossible, with why in plain words. */
export type ConvertOutcome =
  | { readonly outcome: 'same' | 'converted'; readonly value: unknown }
  | { readonly outcome: 'empty'; readonly reason: string };

/** The reasons a value can't convert, as the preview counts them. */
export const CONVERT_REASONS = {
  tooLong: 'Longer than 500 characters.',
  notEmail: 'Not an email address.',
  notLink: 'Not a link.',
  notPhone: 'Not a phone number.',
  notNumber: 'Not a number.',
  noCurrency: 'Pick a currency first.',
  notSupported: 'This type can’t change to that one.',
} as const;

const empty = (reason: string): ConvertOutcome => ({ outcome: 'empty', reason });

/** `parsed` as the outcome of `value`: the same when nothing changed, else converted. */
const kept = (value: unknown, parsed: unknown): ConvertOutcome => ({
  outcome: parsed === value ? 'same' : 'converted',
  value: parsed,
});

/** Text as a link: as typed when it is one, else with `https://` before it ("acme.com" is a link). */
function asLink(text: string): string | undefined {
  const direct = UrlValue.safeParse(text);
  if (direct.success) return direct.data;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(text.trim())) return undefined;
  const prefixed = UrlValue.safeParse(`https://${text.trim()}`);
  return prefixed.success ? prefixed.data : undefined;
}

/**
 * One value of the type `from` (a picker key) as a value of `to`, decoded as the engine reads it (text as a
 * string, a select as its option id, a number as its canonical decimal, a currency as `{ amount, currency }`).
 * Pure. A pair outside `TYPE_CHANGES` is `empty`.
 */
export function convertValue(from: string, to: string, value: unknown, context: ConvertContext = {}): ConvertOutcome {
  if (!isTypeChange(from, to)) return empty(CONVERT_REASONS.notSupported);
  const text = typeof value === 'string' ? value : undefined;
  switch (`${from}>${to}`) {
    case 'text>long_text': {
      const parsed = LongTextValue.safeParse(text);
      return parsed.success ? kept(value, parsed.data) : empty(CONVERT_REASONS.tooLong);
    }
    case 'long_text>text': {
      const parsed = TextValue.safeParse(text);
      return parsed.success ? kept(value, parsed.data) : empty(CONVERT_REASONS.tooLong);
    }
    case 'select>multi_select':
      // The option ids carry over: they belong to the attribute, whatever it holds.
      return text === undefined ? empty(CONVERT_REASONS.notSupported) : { outcome: 'same', value: [text] };
    case 'number>currency': {
      const code = context.defaultCurrency;
      if (code === undefined || !(CURRENCY_CODES as readonly string[]).includes(code)) {
        return empty(CONVERT_REASONS.noCurrency);
      }
      const amount = NumberValue.safeParse(value);
      return amount.success
        ? { outcome: 'converted', value: { amount: amount.data, currency: code } }
        : empty(CONVERT_REASONS.notNumber);
    }
    case 'currency>number': {
      const amount = NumberValue.safeParse(
        typeof value === 'object' && value !== null ? (value as { amount?: unknown }).amount : undefined,
      );
      return amount.success ? { outcome: 'converted', value: amount.data } : empty(CONVERT_REASONS.notNumber);
    }
    case 'text>email': {
      const parsed = EmailValue.safeParse(text);
      return parsed.success ? kept(value, parsed.data) : empty(CONVERT_REASONS.notEmail);
    }
    case 'text>link': {
      const link = text === undefined ? undefined : asLink(text);
      return link === undefined ? empty(CONVERT_REASONS.notLink) : kept(value, link);
    }
    case 'text>phone': {
      const parsed = text === undefined ? undefined : context.phone?.parse(text, context.defaultCountry);
      return parsed === undefined
        ? empty(CONVERT_REASONS.notPhone)
        : { outcome: 'converted', value: { number: parsed.number, country: parsed.country } };
    }
    default:
      return empty(CONVERT_REASONS.notSupported);
  }
}
