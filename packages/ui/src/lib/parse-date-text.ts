// A day typed in words or numbers, as Linear's and Twenty's date fields take
// it: "tomorrow", "next fri", "in 2 weeks", "Oct 8", "8/10", "2026-11-03".
// Pure and on day keys (`YYYY-MM-DD`), so DatePicker's "Type a date" row and
// the field set's Date (later, Date.fromText) read text the same way, and it
// is tested in Node. Every date is a calendar date, computed in UTC.

/** The words the parser knows, lower case. English by default; a language passes its own. */
export interface DateWords {
  readonly today: readonly string[];
  readonly tomorrow: readonly string[];
  readonly yesterday: readonly string[];
  /** "next fri", "next week", "next month". */
  readonly next: readonly string[];
  /** "this fri". */
  readonly this: readonly string[];
  /** "in 2 weeks". */
  readonly in: readonly string[];
  /** "2 weeks ago". */
  readonly ago: readonly string[];
  readonly week: readonly string[];
  readonly month: readonly string[];
  /** "end of month". */
  readonly endOfMonth: readonly string[];
  /** The units "in 3 days" takes: each unit's words, the shortest first. */
  readonly units: {
    readonly day: readonly string[];
    readonly week: readonly string[];
    readonly month: readonly string[];
    readonly year: readonly string[];
  };
}

/** The English words: what the app's copy is written in. */
export const ENGLISH_DATE_WORDS: DateWords = {
  today: ['today', 'tod', 'now'],
  tomorrow: ['tomorrow', 'tmr', 'tmrw', 'tom'],
  yesterday: ['yesterday', 'yday'],
  next: ['next'],
  this: ['this'],
  in: ['in'],
  ago: ['ago'],
  week: ['week', 'wk'],
  month: ['month', 'mo'],
  endOfMonth: ['end of month', 'eom', 'end of the month'],
  units: {
    day: ['d', 'day', 'days'],
    week: ['w', 'wk', 'wks', 'week', 'weeks'],
    month: ['m', 'mo', 'mos', 'month', 'months'],
    year: ['y', 'yr', 'yrs', 'year', 'years'],
  },
};

/** What the parser reads against. */
export interface ParseDateContext {
  /** Today, `YYYY-MM-DD`, in the reader's time zone. */
  readonly today: string;
  /** The reader's language: its month and weekday names, and the order of a numeric day ("8/10"). */
  readonly locale: string;
  /** The week's first day, 0 (Sunday) to 6 (Saturday), for "next week" and "next fri". Monday by default. */
  readonly firstDayOfWeek?: number;
  readonly words?: DateWords;
}

interface Day {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const DAY_MS = 86_400_000;

function toKey({ year, month, day }: Day): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function fromKey(key: string): Day {
  const [year = 1970, month = 1, day = 1] = key.split('-').map(Number);
  return { year, month, day };
}

/** The day, if it exists in the calendar (no 30 February). */
function realDay(year: number, month: number, day: number): string | undefined {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return undefined;
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return undefined;
  const at = new Date(Date.UTC(year, month - 1, day));
  if (at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return undefined;
  return toKey({ year, month, day });
}

function utc(key: string): number {
  const { year, month, day } = fromKey(key);
  return Date.UTC(year, month - 1, day);
}

function plusDays(key: string, days: number): string {
  return new Date(utc(key) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Months later, kept to the month's last day (31 January plus a month is 28 or 29 February). */
function plusMonths(key: string, months: number): string {
  const { year, month, day } = fromKey(key);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return toKey({ year: first.getUTCFullYear(), month: first.getUTCMonth() + 1, day: Math.min(day, last) });
}

function weekday(key: string): number {
  return new Date(utc(key)).getUTCDay();
}

function startOfWeek(key: string, firstDay: number): string {
  return plusDays(key, -((weekday(key) - firstDay + 7) % 7));
}

function endOfMonth(key: string): string {
  const { year, month } = fromKey(key);
  return toKey({ year, month, day: new Date(Date.UTC(year, month, 0)).getUTCDate() });
}

/** Lower case names of the months (1 to 12) and weekdays (0 Sunday to 6 Saturday), long and short, in the language. */
function names(locale: string): { readonly months: readonly string[][]; readonly weekdays: readonly string[][] } {
  const month = (style: 'long' | 'short') => new Intl.DateTimeFormat(locale, { month: style, timeZone: 'UTC' });
  const weekdayFormat = (style: 'long' | 'short') =>
    new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' });
  const clean = (text: string) => text.toLocaleLowerCase(locale).replace(/\.$/u, '');
  const months = Array.from({ length: 12 }, (_, index) => {
    const at = Date.UTC(2026, index, 15);
    return [clean(month('long').format(at)), clean(month('short').format(at))];
  });
  // 4 January 2026 was a Sunday.
  const weekdays = Array.from({ length: 7 }, (_, index) => {
    const at = Date.UTC(2026, 0, 4 + index);
    return [clean(weekdayFormat('long').format(at)), clean(weekdayFormat('short').format(at))];
  });
  return { months, weekdays };
}

/** The index a word names among the names, by a whole name or a prefix of three letters or more. */
function nameIndex(word: string, list: readonly string[][]): number | undefined {
  if (word.length === 0) return undefined;
  const found = list.findIndex((forms) =>
    forms.some((form) => form === word || (word.length >= 3 && form.startsWith(word))),
  );
  return found === -1 ? undefined : found;
}

/** Whether the language writes the day before the month in a numeric date (8/10 is 8 October in British English). */
function isDayFirst(locale: string): boolean {
  const order = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', timeZone: 'UTC' })
    .formatToParts(Date.UTC(2026, 9, 8))
    .map((part) => part.type)
    .filter((type) => type === 'day' || type === 'month');
  return order[0] === 'day';
}

/** The language's order of a full numeric date, for "8/10/2026". */
function numericOrder(locale: string): readonly ('day' | 'month' | 'year')[] {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .formatToParts(Date.UTC(2026, 9, 8))
    .map((part) => part.type)
    .filter((type): type is 'day' | 'month' | 'year' => type === 'day' || type === 'month' || type === 'year');
}

function fullYear(year: number): number {
  return year < 100 ? 2000 + year : year;
}

/** "in 3 days", "3d", "2 weeks ago", "+2w", "-1m". */
function relative(text: string, today: string, words: DateWords): string | undefined {
  const pattern = /^(?:(\p{L}+)\s+)?([+-]?)(\d{1,3})\s*(\p{L}+)(?:\s+(\p{L}+))?$/u;
  const match = pattern.exec(text);
  if (match === null) return undefined;
  const [, lead, sign, amountText, unitWord, tail] = match;
  if (lead !== undefined && !words.in.includes(lead)) return undefined;
  const isAgo = tail !== undefined && words.ago.includes(tail);
  if (tail !== undefined && !isAgo) return undefined;
  const amount = Number(amountText) * (sign === '-' || isAgo ? -1 : 1);
  const unit = (Object.keys(words.units) as (keyof DateWords['units'])[]).find((key) =>
    words.units[key].includes(unitWord ?? ''),
  );
  if (unit === undefined) return undefined;
  if (unit === 'day') return plusDays(today, amount);
  if (unit === 'week') return plusDays(today, amount * 7);
  if (unit === 'month') return plusMonths(today, amount);
  return plusMonths(today, amount * 12);
}

/** "Oct 8", "8 Oct", "October 8 2027", "8 oct 27", "oct 8, 2027". The year defaults to today's. */
function named(text: string, today: string, months: readonly string[][]): string | undefined {
  const tokens = text.split(/[\s,]+/u).filter((token) => token !== '');
  if (tokens.length < 2 || tokens.length > 3) return undefined;
  const numbers = tokens.filter((token) => /^\d+$/u.test(token)).map(Number);
  const words = tokens.filter((token) => !/^\d+$/u.test(token));
  if (words.length !== 1 || numbers.length !== tokens.length - 1) return undefined;
  const month = nameIndex(words[0] ?? '', months);
  if (month === undefined) return undefined;
  // The day is the first number unless it reads as a year (four figures).
  const [first, second] = numbers;
  if (first === undefined) return undefined;
  const day = first;
  const year = second === undefined ? fromKey(today).year : fullYear(second);
  return realDay(year, month + 1, day);
}

/** "8/10", "8.10.2026", "10-8-26", "2026-10-08". */
function numeric(text: string, today: string, locale: string): string | undefined {
  if (/^\d{4}-\d{1,2}-\d{1,2}$/u.test(text)) {
    const [year, month, day] = text.split('-').map(Number);
    return realDay(year ?? 0, month ?? 0, day ?? 0);
  }
  if (!/^\d{1,4}([./-])\d{1,2}(?:\1\d{1,4})?$/u.test(text)) return undefined;
  const parts = text.split(/[./-]/u).map(Number);
  if (parts.length === 2) {
    const [a = 0, b = 0] = parts;
    const [day, month] = isDayFirst(locale) ? [a, b] : [b, a];
    return realDay(fromKey(today).year, month, day);
  }
  const value: Record<string, number> = {};
  numericOrder(locale).forEach((type, index) => {
    value[type] = parts[index] ?? 0;
  });
  return realDay(fullYear(value.year ?? 0), value.month ?? 0, value.day ?? 0);
}

/**
 * The day `text` names, `YYYY-MM-DD`, or undefined when it names none. Reads, ignoring case and spaces around:
 * today, tomorrow and yesterday; a weekday ("fri" is the next Friday after today, "this fri" this week's on or after
 * today, "next fri" the Friday of next week); "next week" (its first day) and "next month" (its 1st); "end of month";
 * an amount ("in 2 weeks", "3d", "2 months ago"); a named month ("Oct 8", "8 October 2027"), this year unless one is
 * given; a numeric day in the language's order ("8/10", "08.10.2026") or ISO; and a bare day of this month ("15").
 */
export function parseDateText(text: string, context: ParseDateContext): string | undefined {
  const { today, locale, firstDayOfWeek = 1, words = ENGLISH_DATE_WORDS } = context;
  const input = text.trim().toLocaleLowerCase(locale).replace(/\s+/gu, ' ');
  if (input === '') return undefined;
  if (words.today.includes(input)) return today;
  if (words.tomorrow.includes(input)) return plusDays(today, 1);
  if (words.yesterday.includes(input)) return plusDays(today, -1);
  if (words.endOfMonth.includes(input)) return endOfMonth(today);

  const { months, weekdays } = names(locale);
  const [head = '', ...rest] = input.split(' ');
  const tail = rest.join(' ');
  if (words.next.includes(head)) {
    if (words.week.includes(tail)) return plusDays(startOfWeek(today, firstDayOfWeek), 7);
    if (words.month.includes(tail)) return plusMonths(`${today.slice(0, 7)}-01`, 1);
    const day = nameIndex(tail, weekdays);
    if (day === undefined) return undefined;
    const nextWeek = plusDays(startOfWeek(today, firstDayOfWeek), 7);
    return plusDays(nextWeek, (day - firstDayOfWeek + 7) % 7);
  }
  if (words.this.includes(head)) {
    const day = nameIndex(tail, weekdays);
    if (day === undefined) return undefined;
    return plusDays(today, (day - weekday(today) + 7) % 7);
  }
  if (rest.length === 0 && !/\d/u.test(input)) {
    const day = nameIndex(input, weekdays);
    if (day !== undefined) return plusDays(today, ((day - weekday(today) + 6) % 7) + 1);
  }
  if (/^\d{1,2}$/u.test(input)) {
    const { year, month } = fromKey(today);
    return realDay(year, month, Number(input));
  }
  return relative(input, today, words) ?? named(input, today, months) ?? numeric(input, today, locale);
}
