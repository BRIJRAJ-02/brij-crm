// Zod's own messages in plain words: the safety net under every schema that
// sets no message of its own. Zod's English ("Too small: expected string to
// have >=1 characters") names types, echoes limits as code and can show a
// pattern; a person sees these words instead. A message a schema sets always
// wins: Zod asks this map only when the schema, its check and the parse set
// none. The words never repeat what the person typed, and never name a type,
// a pattern or a choice's internal value.
//
// `@crm/contracts/plain-words`: plain TypeScript with no Zod at run time, so
// the browser's data layer (in the first load) can tell these sentences apart.
// `plain-errors.ts` installs them.
import type { $ZodRawIssue } from 'zod/v4/core';

/** The sentences the safety net answers with, by what went wrong. */
export const PLAIN_ERRORS = {
  missing: 'Add this.',
  invalid: 'This isn’t valid.',
  format: 'This isn’t in the right format.',
  number: 'Enter a number.',
  wholeNumber: 'Use a whole number.',
  date: 'This isn’t a valid date.',
  time: 'This isn’t a valid time.',
  laterDate: 'Pick a later date.',
  earlierDate: 'Pick an earlier date.',
  email: 'Enter an email address, such as ada@example.com.',
  url: 'Enter a full web address, such as https://example.com.',
  hostname: 'Enter a web address, such as example.com.',
  phone: 'Enter the number with its country code, such as +447700900123.',
  emoji: 'Pick an emoji.',
  choice: 'Pick one of the choices.',
  atLeastOne: 'Add at least one.',
  oneInvalid: 'One of these isn’t valid.',
  extra: 'This includes something we can’t use.',
  fileSmall: 'This file is too small.',
  fileLarge: 'This file is too large.',
} as const;

const COUNT = new Intl.NumberFormat('en');

/** A limit as people write it: 2,000 rather than 2000. */
function count(limit: number | bigint): string {
  return COUNT.format(limit);
}

const SIZED_LISTS: ReadonlySet<string> = new Set(['array', 'set', 'map']);
const NUMBERS: ReadonlySet<string> = new Set(['number', 'int', 'bigint']);

function tooSmall(origin: string, minimum: number | bigint, inclusive: boolean, exact: boolean): string {
  if (origin === 'string') {
    if (exact) return `Use exactly ${count(minimum)} characters.`;
    // One character is the least there is: the field is empty.
    return minimum <= 1 ? PLAIN_ERRORS.missing : `Use ${count(minimum)} characters or more.`;
  }
  if (SIZED_LISTS.has(origin)) {
    if (exact) return `Use exactly ${count(minimum)}.`;
    return minimum <= 1 ? PLAIN_ERRORS.atLeastOne : `Add at least ${count(minimum)}.`;
  }
  if (NUMBERS.has(origin))
    return inclusive ? `Use ${count(minimum)} or more.` : `Use a number above ${count(minimum)}.`;
  if (origin === 'date') return PLAIN_ERRORS.laterDate;
  if (origin === 'file') return PLAIN_ERRORS.fileSmall;
  return PLAIN_ERRORS.invalid;
}

function tooBig(origin: string, maximum: number | bigint, inclusive: boolean, exact: boolean): string {
  if (origin === 'string') {
    return exact ? `Use exactly ${count(maximum)} characters.` : `Use ${count(maximum)} characters or fewer.`;
  }
  if (SIZED_LISTS.has(origin)) return exact ? `Use exactly ${count(maximum)}.` : `Use ${count(maximum)} or fewer.`;
  if (NUMBERS.has(origin))
    return inclusive ? `Use ${count(maximum)} or less.` : `Use a number below ${count(maximum)}.`;
  if (origin === 'date') return PLAIN_ERRORS.earlierDate;
  if (origin === 'file') return PLAIN_ERRORS.fileLarge;
  return PLAIN_ERRORS.invalid;
}

function badFormat(format: string): string {
  switch (format) {
    case 'email':
      return PLAIN_ERRORS.email;
    case 'url':
      return PLAIN_ERRORS.url;
    case 'hostname':
      return PLAIN_ERRORS.hostname;
    case 'date':
    case 'datetime':
      return PLAIN_ERRORS.date;
    case 'time':
      return PLAIN_ERRORS.time;
    case 'e164':
      return PLAIN_ERRORS.phone;
    case 'emoji':
      return PLAIN_ERRORS.emoji;
    default:
      return PLAIN_ERRORS.format;
  }
}

function wrongType(expected: string, input: unknown): string {
  // Nothing there at all: the commonest case, a required field left out.
  if (input === undefined || input === null) return PLAIN_ERRORS.missing;
  if (expected === 'int') return typeof input === 'number' ? PLAIN_ERRORS.wholeNumber : PLAIN_ERRORS.number;
  if (expected === 'number' || expected === 'bigint' || expected === 'nan') return PLAIN_ERRORS.number;
  if (expected === 'date') return PLAIN_ERRORS.date;
  return PLAIN_ERRORS.invalid;
}

/**
 * The plain sentence for one of Zod's issues, by its code alone: what a
 * schema with no message of its own says. Never the input, a type name, a
 * pattern or the list of allowed values.
 */
export function plainIssueMessage(issue: $ZodRawIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return wrongType(issue.expected, issue.input);
    case 'too_small':
      return tooSmall(issue.origin, issue.minimum, issue.inclusive === true, issue.exact === true);
    case 'too_big':
      return tooBig(issue.origin, issue.maximum, issue.inclusive === true, issue.exact === true);
    case 'invalid_format':
      return badFormat(issue.format);
    case 'not_multiple_of':
      return issue.divisor === 1 ? PLAIN_ERRORS.wholeNumber : `Use a multiple of ${count(issue.divisor)}.`;
    case 'invalid_value':
      return PLAIN_ERRORS.choice;
    case 'invalid_union':
      // A tagged union whose tag matched nothing is a choice; any other is a value that fits no shape.
      return issue.discriminator === undefined ? PLAIN_ERRORS.invalid : PLAIN_ERRORS.choice;
    case 'unrecognized_keys':
      return PLAIN_ERRORS.extra;
    case 'invalid_key':
    case 'invalid_element':
      return PLAIN_ERRORS.oneInvalid;
    default:
      return PLAIN_ERRORS.invalid;
  }
}

/** The safety net's sentences that carry a number, as patterns: a limit, a count or a step. */
const COUNTED: readonly RegExp[] = [
  /^Use (exactly )?-?[\d.,]+ characters( or (more|fewer))?\.$/,
  /^Use (exactly )?-?[\d.,]+( or (more|less|fewer))?\.$/,
  /^Use a number (above|below) -?[\d.,]+\.$/,
  /^Add at least -?[\d.,]+\.$/,
  /^Use a multiple of -?[\d.,]+\.$/,
];

const FIXED: ReadonlySet<string> = new Set(Object.values(PLAIN_ERRORS));

/**
 * Whether a sentence is one of the safety net's. They name no field ("Add
 * this.", "Use 60 characters or fewer."), so they read right only under the
 * field they are about, never alone in a toast or a banner.
 */
export function isPlainFallback(message: string): boolean {
  return FIXED.has(message) || COUNTED.some((pattern) => pattern.test(message));
}
