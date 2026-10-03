// The exact shape of every attribute value (spec 0003, attribute values). The
// fields in packages/ui, the API and the database all parse with these, so a
// date or an amount means one thing everywhere. Each schema parses its input
// into one canonical form, so equal values compare equal. Empty is `null` on
// the wire, and a checkbox is never empty.
import * as z from 'zod';
import { isCountryCode } from './countries.ts';
import { CURRENCY_CODES } from './currencies.ts';
import { Decimal } from './decimal.ts';

/** Every attribute type. Formula, rollup, lookup and AI attributes produce one of these. */
export const AttributeType = z.enum([
  'text',
  'long_text',
  'number',
  'currency',
  'date',
  'timestamp',
  'checkbox',
  'select',
  'status',
  'rating',
  'email',
  'phone',
  'domain',
  'url',
  'location',
  'personal_name',
  'actor_reference',
  'record_reference',
  'file',
  'interaction',
]);
export type AttributeType = z.infer<typeof AttributeType>;

/** The types that can hold a list when the attribute allows several values (a record reference follows its relation's cardinality). */
export const MULTIPLE_VALUE_TYPES = [
  'select',
  'email',
  'phone',
  'domain',
  'url',
  'actor_reference',
  'record_reference',
  'file',
] as const satisfies readonly AttributeType[];

/** The types only the system writes: people never edit them. */
export const SYSTEM_ONLY_TYPES = ['timestamp', 'interaction'] as const satisfies readonly AttributeType[];

/** The stable code on every refused attribute value. */
export const ATTRIBUTE_VALUE_INVALID = 'ATTRIBUTE_VALUE_INVALID';

const id = (what: string) =>
  z
    .string()
    .trim()
    .min(1, { error: `Give the ${what}.` });

/** An instant in UTC, ISO 8601 with milliseconds and a `Z`: `2026-10-01T09:30:00.000Z`. */
export const Timestamp = z.iso.datetime({
  precision: 3,
  error: 'Give the time in UTC with milliseconds, such as 2026-10-01T09:30:00.000Z.',
});
export type Timestamp = z.infer<typeof Timestamp>;

/**
 * A moment a caller asks about (values as of a time, a purge cutoff): a full
 * ISO 8601 date and time, seconds and fractions optional, with its zone (`Z`
 * or an offset). A bare year, a month or a time with no zone names no one
 * instant, so it is refused rather than read in some default zone.
 */
export const IsoInstant = z.iso.datetime({
  offset: true,
  error: 'Give the moment as an ISO timestamp with its zone, such as 2026-10-01T09:30:00Z.',
});
export type IsoInstant = z.infer<typeof IsoInstant>;

/** One line of text: trimmed, line breaks turned into spaces, 1 to 500 characters. */
export const TextValue = z
  .string()
  .transform((input) => input.replaceAll(/\r\n|\r|\n/g, ' ').trim())
  .pipe(
    z
      .string()
      .min(1, { error: 'Type some text, or clear the value.' })
      .max(500, { error: 'Keep it to 500 characters. Use long text for more.' }),
  );
export type TextValue = z.infer<typeof TextValue>;

/** Plain text with its line breaks: trimmed, 1 to 10,000 characters. */
export const LongTextValue = z
  .string()
  .transform((input) => input.trim())
  .pipe(
    z
      .string()
      .min(1, { error: 'Type some text, or clear the value.' })
      .max(10_000, { error: 'Keep it to 10,000 characters.' }),
  );
export type LongTextValue = z.infer<typeof LongTextValue>;

/** An exact number, as a canonical decimal string. */
export const NumberValue = Decimal;
export type NumberValue = z.infer<typeof NumberValue>;

/** An amount and its currency. The currency sits on each value, so totals can convert mixed currencies. */
export const CurrencyValue = z.object({
  amount: Decimal,
  currency: z.enum(CURRENCY_CODES, { error: 'Pick a currency, such as USD or EUR.' }),
});
export type CurrencyValue = z.infer<typeof CurrencyValue>;

/** A calendar day with no time zone: `YYYY-MM-DD`, and a day that exists. */
export const DateValue = z.iso.date({ error: 'Give a real date, such as 2026-10-08.' });
export type DateValue = z.infer<typeof DateValue>;

/** A moment, written by the system only (created at, last interaction). */
export const TimestampValue = Timestamp;
export type TimestampValue = z.infer<typeof TimestampValue>;

/** Checked or not. Never empty: unchecked is `false`. */
export const CheckboxValue = z.boolean({ error: 'Give true or false.' });
export type CheckboxValue = z.infer<typeof CheckboxValue>;

/** The id of one of the attribute's options. An archived option stays valid on existing values but can't be chosen. */
export const SelectValue = id('option');
export type SelectValue = z.infer<typeof SelectValue>;

/** The id of one of the attribute's statuses. Always single. */
export const StatusValue = id('status');
export type StatusValue = z.infer<typeof StatusValue>;

/** A rating from 1 to 5. No rating is `null`, so zero and empty can't be confused. */
export const RatingValue = z
  .number({ error: 'Give a rating from 1 to 5.' })
  .int({ error: 'Give a whole number of stars, from 1 to 5.' })
  .min(1, { error: 'Give a rating from 1 to 5.' })
  .max(5, { error: 'Give a rating from 1 to 5.' });
export type RatingValue = z.infer<typeof RatingValue>;

/** An email address, trimmed and lowercased, at most 254 characters. */
export const EmailValue = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z
      .email({ error: 'Enter an email address with a name and a domain, such as ada@example.com.' })
      .max(254, { error: 'An email address has at most 254 characters.' }),
  );
export type EmailValue = z.infer<typeof EmailValue>;

/** A phone number in E.164 (`+447700900123`) and the country it belongs to. The editor checks the number exists. */
export const PhoneValue = z.object({
  number: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/, { error: 'Enter the number with its country code, such as +44 7700 900123.' }),
  country: z
    .string()
    .trim()
    .regex(/^[A-Z]{2}$/, { error: 'Give the country as a two letter code, such as GB.' }),
});
export type PhoneValue = z.infer<typeof PhoneValue>;

function hostnameOf(input: string): string | undefined {
  try {
    return new URL(`http://${input}`).hostname;
  } catch {
    return undefined;
  }
}

/** A domain name, lowercased, as the browser reads it (international names as `xn--`), with a dot and no trailing dot. */
export const DomainValue = z
  .string()
  .trim()
  .toLowerCase()
  .check((ctx) => {
    const domain = ctx.value;
    if (hostnameOf(domain) === domain && domain.includes('.') && !domain.endsWith('.')) return;
    ctx.issues.push({
      code: 'custom',
      input: domain,
      message: 'Enter just the domain, such as example.com, with no spaces, path or protocol.',
    });
  });
export type DomainValue = z.infer<typeof DomainValue>;

const URL_PARTS = /^([a-z][a-z\d+.-]*:\/\/)([^/?#]*)(.*)$/is;

/** Lowercases a URL's scheme and host, and nothing else, so the path keeps its case. */
function canonicalUrl(input: string): string {
  const match = URL_PARTS.exec(input);
  if (match === null) return input;
  const [, scheme = '', authority = '', rest = ''] = match;
  const at = authority.lastIndexOf('@');
  const host =
    at === -1 ? authority.toLowerCase() : `${authority.slice(0, at + 1)}${authority.slice(at + 1).toLowerCase()}`;
  return `${scheme.toLowerCase()}${host}${rest}`;
}

function isWebUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** An absolute `http` or `https` URL, at most 2,048 characters. Only the scheme and host are lowercased. */
export const UrlValue = z
  .string()
  .trim()
  .max(2_048, { error: 'A link has at most 2,048 characters.' })
  .refine(isWebUrl, { error: 'Enter a full link that starts with https://.' })
  .transform(canonicalUrl);
export type UrlValue = z.infer<typeof UrlValue>;

const part = z.string().trim().min(1).max(200, { error: 'Keep each part of the address to 200 characters.' });

function inRange(limit: number) {
  return (value: string) => Math.abs(Number(value)) <= limit;
}

/** An address in parts. At least one part; a latitude and longitude come together or not at all. */
export const LocationValue = z
  .object({
    line1: part.optional(),
    line2: part.optional(),
    line3: part.optional(),
    line4: part.optional(),
    locality: part.optional(),
    region: part.optional(),
    postcode: part.optional(),
    countryCode: z
      .string()
      .trim()
      .toUpperCase()
      .refine(isCountryCode, { error: 'Give the country as its two letter ISO code, such as GB.' })
      .optional(),
    latitude: Decimal.refine(inRange(90), { error: 'A latitude is between -90 and 90.' }).optional(),
    longitude: Decimal.refine(inRange(180), { error: 'A longitude is between -180 and 180.' }).optional(),
  })
  .refine((location) => Object.keys(location).length > 0, {
    error: 'Fill in at least one part of the address.',
  })
  .refine((location) => (location.latitude === undefined) === (location.longitude === undefined), {
    error: 'Give both a latitude and a longitude, or neither.',
  });
export type LocationValue = z.infer<typeof LocationValue>;

/** The full name from a first and last name, joined by a space. */
export function fullNameOf(firstName: string | undefined, lastName: string | undefined): string {
  return [firstName, lastName]
    .map((name) => name?.trim() ?? '')
    .filter((name) => name !== '')
    .join(' ');
}

const namePart = z.string().trim().min(1).max(200, { error: 'Keep each name to 200 characters.' });

/** A person's name. `fullName` is required, and is made from the first and last name when not given. */
export const PersonalNameValue = z
  .object({
    firstName: namePart.optional(),
    lastName: namePart.optional(),
    fullName: z.string().trim().max(200, { error: 'Keep the full name to 200 characters.' }).optional(),
  })
  .transform((name) => ({
    ...name,
    fullName:
      name.fullName === undefined || name.fullName === '' ? fullNameOf(name.firstName, name.lastName) : name.fullName,
  }))
  .refine((name) => name.fullName !== '', { error: 'Type a name.' });
export type PersonalNameValue = z.infer<typeof PersonalNameValue>;

/** Who did something: a member, an API key, an automation, or the system (whose id is `null`). People can only set members. */
export const ActorReferenceValue = z
  .object({
    type: z.enum(['member', 'api_key', 'automation', 'system'], { error: 'Pick who it was.' }),
    id: z.string().trim().min(1).nullable(),
  })
  .refine((actor) => (actor.type === 'system') === (actor.id === null), {
    error: 'Only the system has no id; every other actor needs one.',
  });
export type ActorReferenceValue = z.infer<typeof ActorReferenceValue>;

/** A link to another record. The relation decides which objects it may point to. */
export const RecordReferenceValue = z.object({ objectId: id('object'), recordId: id('record') });
export type RecordReferenceValue = z.infer<typeof RecordReferenceValue>;

/** An uploaded file: its id, name, size in bytes and MIME type. */
export const FileValue = z.object({
  fileId: id('file'),
  name: z.string().trim().min(1).max(255, { error: 'A file name has at most 255 characters.' }),
  size: z.number().int().nonnegative({ error: 'Give the size in bytes.' }),
  contentType: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]+\/[a-z\d!#$&^_.+-]+$/, { error: 'Give the file type, such as application/pdf.' }),
});
export type FileValue = z.infer<typeof FileValue>;

/** The last email or meeting with a record, written by the system only. */
export const InteractionValue = z.object({
  kind: z.enum(['email', 'meeting']),
  at: Timestamp,
  by: ActorReferenceValue,
});
export type InteractionValue = z.infer<typeof InteractionValue>;

/** The schema for one value of each type. */
export const VALUE_SCHEMAS = {
  text: TextValue,
  long_text: LongTextValue,
  number: NumberValue,
  currency: CurrencyValue,
  date: DateValue,
  timestamp: TimestampValue,
  checkbox: CheckboxValue,
  select: SelectValue,
  status: StatusValue,
  rating: RatingValue,
  email: EmailValue,
  phone: PhoneValue,
  domain: DomainValue,
  url: UrlValue,
  location: LocationValue,
  personal_name: PersonalNameValue,
  actor_reference: ActorReferenceValue,
  record_reference: RecordReferenceValue,
  file: FileValue,
  interaction: InteractionValue,
} as const satisfies Record<AttributeType, z.ZodType>;

/** What to say when a value is refused in a way no rule above words itself (a missing key, a wrong type). */
const HOW_TO_FIX: Record<AttributeType, string> = {
  text: 'Type some text, or clear the value.',
  long_text: 'Type some text, or clear the value.',
  number: 'Enter a number, such as 1234.5.',
  currency: 'Enter an amount and pick its currency.',
  date: 'Give a real date, such as 2026-10-08.',
  timestamp: 'Give the time in UTC with milliseconds, such as 2026-10-01T09:30:00.000Z.',
  checkbox: 'Give true or false.',
  select: 'Pick one of the options.',
  status: 'Pick one of the statuses.',
  rating: 'Give a rating from 1 to 5.',
  email: 'Enter an email address, such as ada@example.com.',
  phone: 'Enter the number with its country code, such as +44 7700 900123.',
  domain: 'Enter a domain, such as example.com.',
  url: 'Enter a full link that starts with https://.',
  location: 'Fill in the parts of the address.',
  personal_name: 'Type a first and last name, or a full name.',
  actor_reference: 'Pick a member.',
  record_reference: 'Choose a record.',
  file: 'Upload the file again.',
  interaction: 'Only the system records emails and meetings; it gives the kind, the time and who.',
};

/** One value of each attribute type, by type. */
export type AttributeValueOf<T extends AttributeType> = z.output<(typeof VALUE_SCHEMAS)[T]>;

/** One value of any attribute type. */
export type AttributeValue = AttributeValueOf<AttributeType>;

/** How a list item is compared for uniqueness: its canonical form, with object keys in order. */
function identityOf(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(identityOf).join(',')}]`;
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${key}:${identityOf(item)}`).join(',')}}`;
}

function listOf<S extends z.ZodType>(schema: S) {
  return z
    .array(schema)
    .min(1, { error: 'Add at least one value, or clear it.' })
    .max(100, { error: 'An attribute holds at most 100 values.' })
    .refine((items) => new Set(items.map(identityOf)).size === items.length, {
      error: 'Each value can appear only once.',
    });
}

/** What the attribute allows: several values, or just one. */
export interface AttributeValueOptions {
  /** True when the attribute holds a list (several emails, tags, people). Ignored for types that are always single. */
  readonly allowMultiple?: boolean;
}

/**
 * The full schema for one attribute's value: one value, a list of 1 to 100
 * unique values when the attribute allows several, or `null` for empty. A
 * checkbox is never `null`.
 */
export function attributeValueSchema(type: AttributeType, { allowMultiple = false }: AttributeValueOptions = {}) {
  const one: z.ZodType = VALUE_SCHEMAS[type];
  if (type === 'checkbox') return one;
  const multiple = allowMultiple && (MULTIPLE_VALUE_TYPES as readonly AttributeType[]).includes(type);
  return (multiple ? listOf(one) : one).nullable();
}

/** A refused attribute value: the stable code and a sentence saying how to fix the input. */
export interface AttributeValueError {
  readonly code: typeof ATTRIBUTE_VALUE_INVALID;
  readonly message: string;
}

/** The outcome of `parseAttributeValue`: the canonical value, or why it was refused. */
export type AttributeValueResult =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: AttributeValueError };

/** Parses one attribute's value into its canonical form, or refuses it with `ATTRIBUTE_VALUE_INVALID` and how to fix it. */
export function parseAttributeValue(
  type: AttributeType,
  input: unknown,
  options: AttributeValueOptions = {},
): AttributeValueResult {
  // Rules that word their own refusal win; anything else gets the type's sentence.
  const result = attributeValueSchema(type, options).safeParse(input, { error: () => HOW_TO_FIX[type] });
  if (result.success) return { ok: true, value: result.data };
  const message = result.error.issues[0]?.message ?? 'This value does not fit the attribute.';
  return { ok: false, error: { code: ATTRIBUTE_VALUE_INVALID, message } };
}

/** The domain part of an email address (`ada@example.com` gives `example.com`). */
export function emailDomain(email: EmailValue): string {
  return email.slice(email.lastIndexOf('@') + 1);
}
