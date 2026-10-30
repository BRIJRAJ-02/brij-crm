// What an attribute's type specific settings may hold, and its default value
// (spec 0004). The engine parses both before they reach the database, so a bad
// config never gets stored.
import * as z from 'zod';
import type { AttributeType } from './attribute-values.ts';
import { COUNTRY_CODES } from './countries.ts';
import { CURRENCY_CODES } from './currencies.ts';

const none = z.strictObject({});

/** The settings each type takes. Most take none; their options or relationship live in their own rows. */
export const AttributeConfig = {
  text: none,
  long_text: none,
  // `compact` shows 1.2M for 1,200,000; `decimals` fixes how many decimals show (0 to 4), all of them when absent.
  number: z.strictObject({
    display: z.enum(['plain', 'percent', 'compact']).default('plain'),
    decimals: z.number().int().min(0).max(4).optional(),
  }),
  currency: z.strictObject({
    defaultCurrency: z.enum(CURRENCY_CODES, { error: 'Pick the default currency, such as USD.' }),
  }),
  date: none,
  timestamp: none,
  checkbox: none,
  select: none,
  status: none,
  rating: none,
  email: none,
  // The country a number typed without its code is read in; the workspace's when absent.
  phone: z.strictObject({
    defaultCountry: z.enum(COUNTRY_CODES, { error: 'Pick a country, such as GB.' }).optional(),
  }),
  domain: none,
  url: none,
  location: none,
  personal_name: none,
  actor_reference: none,
  record_reference: none,
  file: none,
  interaction: none,
} as const satisfies Record<AttributeType, z.ZodType>;

/** The settings of one type, as parsed. */
export type AttributeConfigOf<T extends AttributeType> = z.output<(typeof AttributeConfig)[T]>;

/** An ISO 8601 duration the defaults can add to now: years, months, weeks, days, then hours and minutes. */
const Duration = z.string().regex(/^P(?=\d|T\d)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?)?$/, {
  error: 'Give the offset as an ISO 8601 duration, such as P1M for a month.',
});

/**
 * An attribute's default: a fixed value (parsed by the type's own schema),
 * the member creating the record (actor references), or now plus an offset
 * (dates and timestamps; dates in the viewer's time zone).
 */
export const AttributeDefault = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('static'), value: z.unknown() }),
  z.strictObject({ kind: z.literal('current_user') }),
  z.strictObject({ kind: z.literal('offset'), duration: Duration }),
]);
export type AttributeDefault = z.infer<typeof AttributeDefault>;

/**
 * Which default kinds each type may have. A timestamp takes only now plus an
 * offset (a fixed moment for every new record is never what a date and time
 * field means), and an interaction, which only the system writes, takes none.
 */
export function defaultKindsFor(type: AttributeType): readonly AttributeDefault['kind'][] {
  if (type === 'actor_reference') return ['static', 'current_user'];
  if (type === 'date') return ['static', 'offset'];
  if (type === 'timestamp') return ['offset'];
  if (type === 'record_reference' || type === 'interaction' || type === 'file') return [];
  return ['static'];
}
