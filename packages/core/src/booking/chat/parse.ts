// The booking chat's readers (spec 0041, AC-1505 to AC-1513): pure functions
// over one visitor message, each reading one thing out of it. Ported from
// timefix's booking agent, with chrono-node replaced by a parser written for
// exactly the phrases the spec lists, and all zone math in luxon (the slot
// engine's library), so "tomorrow" is the visitor's tomorrow wherever the
// server runs.
import { DateTime } from 'luxon';

/** A time the visitor asked for: one instant, or a window with the words to say it back in. */
export type TimeAsk =
  | {
      readonly kind: 'point';
      readonly at: DateTime;
      /** No day was said ("3pm"), so it may pick among the times on the table. */
      readonly dateImplied: boolean;
      /** "4pm" or "4am" was written, so a bare 4 is never moved to the afternoon. */
      readonly wroteMeridiem: boolean;
    }
  | { readonly kind: 'window'; readonly start: DateTime; readonly end: DateTime; readonly phrase: string };

const WEEKDAYS: readonly (readonly [RegExp, number])[] = [
  [/^mon(day)?$/, 1],
  [/^tue(s|sday)?$/, 2],
  [/^wed(nesday)?$/, 3],
  [/^thu(r|rs|rsday)?$/, 4],
  [/^fri(day)?$/, 5],
  [/^sat(urday)?$/, 6],
  [/^sun(day)?$/, 7],
];
const WEEKDAY_WORD =
  /\b(?:(next|this|on|coming)\s+)?(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;
const MONTH =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const ORDINAL = '(\\d{1,2})(?:st|nd|rd|th)?';
const DAY_MONTH = new RegExp(`\\b${ORDINAL}(?:\\s+of)?\\s+${MONTH}\\b`);
const MONTH_DAY = new RegExp(`\\b${MONTH}\\.?\\s+${ORDINAL}\\b`);
const THE_NTH = /\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/;
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/;

const DAYPARTS: readonly {
  readonly re: RegExp;
  readonly start: number;
  readonly end: number;
  readonly word: string;
}[] = [
  { re: /\bmorning\b/, start: 8, end: 12, word: 'morning' },
  { re: /\bafternoon\b/, start: 12, end: 17, word: 'afternoon' },
  { re: /\b(evening|tonight|night)\b/, start: 17, end: 21, word: 'evening' },
  { re: /\b(midday|lunch|lunchtime)\b/, start: 11, end: 14, word: 'lunchtime' },
];

const MERIDIEM = '(a\\.?m\\.?|p\\.?m\\.?)';
const RANGE = new RegExp(
  `\\b(?:between\\s+|from\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*${MERIDIEM}?\\s*(?:-|–|to|and|until|till)\\s*(\\d{1,2})(?::(\\d{2}))?\\s*${MERIDIEM}(?![a-z])`,
);
const RANGE_BETWEEN = /\bbetween\s+(\d{1,2})(?::(\d{2}))?\s+and\s+(\d{1,2})(?::(\d{2}))?\b/;
const POINT_MERIDIEM = new RegExp(`\\b(\\d{1,2})(?::(\\d{2}))?\\s*${MERIDIEM}(?![a-z])`);
const POINT_CLOCK = /\b(\d{1,2}):(\d{2})\b/;
const POINT_AT =
  /\b(?:at|@|around|about|by)\s+(\d{1,2})\b(?!\s*(?:st|nd|rd|th|min|mins|minutes?|hours?|hrs?|people|\/|-|\.))/;
const SOON = /\b(asap|soonest|earliest|anytime|any time|whenever|first available|next available)\b/;

/** The words of a message, lower case, with curly quotes made straight. */
function plain(text: string): string {
  return text.toLowerCase().replaceAll(/[’‘]/g, "'");
}

/** 1 to 12 with am or pm as a 24 hour hour. */
function to24(hour: number, meridiem: string | undefined): number {
  if (meridiem === undefined) return hour;
  const pm = meridiem.startsWith('p');
  if (hour === 12) return pm ? 12 : 0;
  return pm ? hour + 12 : hour;
}

/** How a reply names a day: today, tomorrow, a weekday within the week, else "Tue 28 Oct". */
export function dayWord(day: DateTime, now: DateTime): string {
  const days = Math.round(day.startOf('day').diff(now.startOf('day'), 'days').days);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days > 1 && days < 7) return day.setLocale('en').toFormat('cccc');
  return day.setLocale('en').toFormat('ccc d LLL');
}

/** The day a message names, from the start of that day in `zone`, or undefined. */
function readDay(text: string, now: DateTime): { readonly day: DateTime; readonly rest: string } | undefined {
  const today = now.startOf('day');
  const cut = (match: RegExpExecArray) =>
    text.slice(0, match.index) + ' '.repeat(match[0].length) + text.slice(match.index + match[0].length);
  const iso = ISO_DATE.exec(text);
  if (iso !== null) {
    const day = DateTime.fromObject(
      { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) },
      { zone: now.zone },
    );
    if (day.isValid) return { day, rest: cut(iso) };
  }
  const named = DAY_MONTH.exec(text) ?? MONTH_DAY.exec(text);
  if (named !== null) {
    const dayFirst = /^\d/.test(named[1] ?? '');
    const dayText = dayFirst ? named[1] : named[2];
    const monthText = dayFirst ? named[2] : named[1];
    const month = MONTHS.findIndex((each) => (monthText ?? '').startsWith(each)) + 1;
    const date = Number(dayText);
    let day = DateTime.fromObject({ year: today.year, month, day: date }, { zone: now.zone });
    if (day.isValid && day < today) day = day.plus({ years: 1 });
    if (day.isValid) return { day, rest: cut(named) };
  }
  const nth = THE_NTH.exec(text);
  if (nth !== null) {
    let day = DateTime.fromObject({ year: today.year, month: today.month, day: Number(nth[1]) }, { zone: now.zone });
    if (day.isValid && day < today) day = day.plus({ months: 1 });
    if (day.isValid) return { day, rest: cut(nth) };
  }
  const after = /\bday after tomorrow\b/.exec(text);
  if (after !== null) return { day: today.plus({ days: 2 }), rest: cut(after) };
  const tomorrow = /\b(tomorrow|tmrw|tmr|tomorow)\b/.exec(text);
  if (tomorrow !== null) return { day: today.plus({ days: 1 }), rest: cut(tomorrow) };
  const todayWord = /\b(today|tonight)\b/.exec(text);
  if (todayWord !== null) return { day: today, rest: text };
  const weekday = WEEKDAY_WORD.exec(text);
  if (weekday !== null) {
    const word = weekday[2] ?? '';
    const target = WEEKDAYS.find(([re]) => re.test(word))?.[1];
    if (target !== undefined) {
      // "Tuesday" is today on a Tuesday; "next Tuesday" is the first one after today.
      const ahead = (target - today.weekday + 7) % 7;
      const days = ahead === 0 && weekday[1] === 'next' ? 7 : ahead;
      return { day: today.plus({ days }), rest: cut(weekday) };
    }
  }
  return undefined;
}

/** A clock time written in a message: hour, minute and whether am or pm was said. */
type Clock = { readonly hour: number; readonly minute: number; readonly wroteMeridiem: boolean };

/** A time range written in a message ("between 2 and 4pm", "1-3pm"). */
function readRange(text: string): { readonly from: Clock; readonly to: Clock } | undefined {
  const range = RANGE.exec(text);
  if (range !== null) {
    const endMeridiem = range[6];
    const endHour = to24(Number(range[4]), endMeridiem);
    let startHour = to24(Number(range[1]), range[3] ?? endMeridiem);
    if (range[3] === undefined && startHour > endHour) startHour = Number(range[1]);
    return {
      from: { hour: startHour, minute: Number(range[2] ?? 0), wroteMeridiem: true },
      to: { hour: endHour, minute: Number(range[5] ?? 0), wroteMeridiem: true },
    };
  }
  const between = RANGE_BETWEEN.exec(text);
  if (between !== null) {
    // "between 2 and 4": office hours, so a bare hour below 8 is the afternoon.
    const hour = (value: number) => (value < 8 ? value + 12 : value);
    return {
      from: { hour: hour(Number(between[1])), minute: Number(between[2] ?? 0), wroteMeridiem: false },
      to: { hour: hour(Number(between[3])), minute: Number(between[4] ?? 0), wroteMeridiem: false },
    };
  }
  return undefined;
}

/** One clock time written in a message ("3pm", "15:00", "at 4", "noon"). */
function readClock(text: string): Clock | undefined {
  if (/\bnoon\b/.test(text)) return { hour: 12, minute: 0, wroteMeridiem: true };
  if (/\bmidnight\b/.test(text)) return { hour: 0, minute: 0, wroteMeridiem: true };
  const meridiem = POINT_MERIDIEM.exec(text);
  if (meridiem !== null) {
    const hour = Number(meridiem[1]);
    if (hour >= 1 && hour <= 12)
      return { hour: to24(hour, meridiem[3]), minute: Number(meridiem[2] ?? 0), wroteMeridiem: true };
  }
  const clock = POINT_CLOCK.exec(text);
  if (clock !== null) {
    const hour = Number(clock[1]);
    const minute = Number(clock[2]);
    if (hour <= 23 && minute <= 59) return { hour, minute, wroteMeridiem: hour === 0 || hour > 12 };
  }
  const at = POINT_AT.exec(text);
  if (at !== null) {
    const hour = Number(at[1]);
    if (hour <= 23) return { hour, minute: 0, wroteMeridiem: hour === 0 || hour > 12 };
  }
  return undefined;
}

/**
 * The time a message asks for, read in the visitor's zone (`now` carries it),
 * or undefined when it names none. `horizonDays` bounds "asap" and "anytime".
 */
export function readTime(message: string, now: DateTime, horizonDays: number): TimeAsk | undefined {
  const text = plain(message);
  const today = now.startOf('day');
  const week = /\b(this|next)\s+week\b/.exec(text);
  if (week !== null) {
    const nextMonday = today.startOf('week').plus({ weeks: 1 });
    return week[1] === 'next'
      ? { kind: 'window', start: nextMonday, end: nextMonday.plus({ weeks: 1 }), phrase: 'next week' }
      : { kind: 'window', start: now, end: nextMonday, phrase: 'this week' };
  }
  if (/\b(this|the)\s+weekend\b|\bweekend\b/.test(text)) {
    const saturday = today.plus({ days: (6 - today.weekday + 7) % 7 });
    return { kind: 'window', start: saturday, end: saturday.plus({ days: 2 }), phrase: 'at the weekend' };
  }
  const found = readDay(text, now);
  const rest = found?.rest ?? text;
  const daypart = DAYPARTS.find((each) => each.re.test(text));
  const range = readRange(rest);
  const clock = range === undefined ? readClock(rest) : undefined;

  // No day: today, or tomorrow once the time has passed.
  const dayFor = (endHour: number, endMinute = 0): { readonly day: DateTime; readonly said?: string } => {
    if (found !== undefined) return { day: found.day };
    const passed = today.set({ hour: endHour, minute: endMinute }) <= now;
    return passed ? { day: today.plus({ days: 1 }), said: 'tomorrow' } : { day: today, said: 'today' };
  };
  const name = (day: DateTime) => dayWord(day, now);

  if (range !== undefined) {
    const { day } = dayFor(range.to.hour, range.to.minute);
    return {
      kind: 'window',
      start: day.set({ hour: range.from.hour, minute: range.from.minute }),
      end: day.set({ hour: range.to.hour, minute: range.to.minute }),
      phrase: `${name(day)} then`,
    };
  }
  if (clock !== undefined && daypart === undefined) {
    const { day } = dayFor(clock.hour, clock.minute);
    return {
      kind: 'point',
      at: day.set({ hour: clock.hour, minute: clock.minute }),
      dateImplied: found === undefined,
      wroteMeridiem: clock.wroteMeridiem,
    };
  }
  if (clock !== undefined && daypart !== undefined) {
    // "3 in the afternoon": the clock in that half of the day.
    const hour = clock.hour < 12 && daypart.start >= 12 ? clock.hour + 12 : clock.hour;
    const { day } = dayFor(hour, clock.minute);
    return {
      kind: 'point',
      at: day.set({ hour, minute: clock.minute }),
      dateImplied: found === undefined,
      wroteMeridiem: true,
    };
  }
  if (daypart !== undefined) {
    const { day, said } = dayFor(daypart.end);
    const dayName = said === 'today' ? 'this' : name(day);
    return {
      kind: 'window',
      start: day.set({ hour: daypart.start }),
      end: day.set({ hour: daypart.end }),
      phrase: `${dayName} ${daypart.word}`,
    };
  }
  if (found !== undefined) {
    return { kind: 'window', start: found.day, end: found.day.plus({ days: 1 }), phrase: name(found.day) };
  }
  if (SOON.test(text)) {
    return { kind: 'window', start: now, end: now.plus({ days: horizonDays }), phrase: 'soon' };
  }
  return undefined;
}

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

/** The email address in a message, lower case, or undefined. */
export function readEmail(text: string): string | undefined {
  const match = EMAIL.exec(text);
  return match === null || match[0].length > 254 ? undefined : match[0].toLowerCase();
}

/** A phone number in a message: 7 to 20 digits, with + ( ) - . and spaces between. */
export function readPhone(text: string): string | undefined {
  const match = /(\+?\d[\d\s().-]{5,26}\d)/.exec(text.replace(EMAIL, ' '));
  if (match === null) return undefined;
  const digits = (match[1] ?? '').replaceAll(/\D/g, '');
  return digits.length >= 7 && digits.length <= 20 ? (match[1] ?? '').trim() : undefined;
}

/** Words never taken for a name on their own. */
const NOT_A_NAME = new Set([
  'yes',
  'no',
  'ok',
  'okay',
  'yep',
  'yeah',
  'nope',
  'sure',
  'thanks',
  'thank',
  'please',
  'hi',
  'hello',
  'hey',
  'book',
  'confirm',
  'cancel',
  'perfect',
  'great',
  'works',
  'sounds',
  'good',
  'fine',
  'later',
  'earlier',
  'something',
  'else',
  'another',
  'other',
  'first',
  'second',
  'third',
  'last',
  'one',
  'that',
  'this',
  'it',
  'what',
  'when',
  'where',
  'how',
  'why',
  'who',
  'which',
  'open',
  'free',
  'any',
  'times',
  'time',
  'next',
  'week',
  'today',
  'tomorrow',
  'morning',
  'afternoon',
  'evening',
  'asap',
  'none',
  'neither',
  'cool',
  'nice',
  'bye',
]);

/** A name introduced in a message ("I'm Ada", "my name is Ada Lovelace"), or undefined. */
export function readIntroducedName(text: string): string | undefined {
  const match = /\b(?:my name is|my name's|name is|name's|i am|i'm|im|this is|it's|its)\s+([a-z][a-z .'-]{0,60})/i.exec(
    text.replaceAll(/[’‘]/g, "'"),
  );
  if (match === null) return undefined;
  const words = (match[1] ?? '')
    .split(/,|\band\b|\bmy\b|\bemail\b|\bat\b|@|\./i)[0]
    ?.trim()
    .split(/\s+/)
    .filter((word) => word !== '')
    .slice(0, 4);
  if (words === undefined || words.length === 0) return undefined;
  if (words.some((word) => NOT_A_NAME.has(word.toLowerCase()))) return undefined;
  return words.join(' ');
}

/** A message that is little more than a name ("Ada Lovelace", "Ada, ada@example.com"), or undefined. */
export function readBareName(text: string): string | undefined {
  const words = text
    .replace(EMAIL, ' ')
    .replaceAll(/\+?\d[\d\s().-]{5,}\d/g, ' ')
    .replaceAll(/\b(my|name|is|and|email|it's|its|phone|number)\b/gi, ' ')
    .replaceAll(/[,;:!]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '');
  if (words.length < 1 || words.length > 4) return undefined;
  if (words.some((word) => NOT_A_NAME.has(word.toLowerCase().replaceAll(/[^a-z]/g, '')))) return undefined;
  if (!words.every((word) => /^\p{L}[\p{L}.'-]*$/u.test(word))) return undefined;
  return words.join(' ');
}

/** A meeting length a message asks for, in minutes, or undefined. */
export function readLength(text: string): number | undefined {
  const words = plain(text);
  if (/\b(an hour and a half|one and a half hours?|1\.5 hours?|90 ?min)/.test(words)) return 90;
  if (/\b(half an hour|half hour|30 ?min)/.test(words)) return 30;
  if (/\b(an hour|one hour|1 hour|1 ?hr|60 ?min)/.test(words)) return 60;
  const minutes = /\b(\d{2,3}) ?(?:min|mins|minutes?)\b/.exec(words);
  if (minutes !== null) return Number(minutes[1]);
  if (/\b(quarter of an hour|quarter hour)\b/.test(words)) return 15;
  return undefined;
}

/** Which of `count` offered times a message picks ("the first", "2", "the last one"), as an index. */
export function readSelection(text: string, count: number): number | undefined {
  if (count === 0) return undefined;
  const words = plain(text).trim();
  const pick = (index: number) => Math.min(index, count - 1);
  if (/\b(first|1st)\b/.test(words) || /^(1|one)\W*$/.test(words)) return 0;
  if (/\b(second|2nd)\b/.test(words) || /^(2|two)\W*$/.test(words)) return pick(1);
  if (/\b(third|3rd)\b/.test(words) || /^(3|three)\W*$/.test(words)) return pick(2);
  if (/\b(fourth|4th)\b/.test(words) || /^4\W*$/.test(words)) return pick(3);
  if (/\b(fifth|5th)\b/.test(words) || /^5\W*$/.test(words)) return pick(4);
  if (/\b(sixth|6th)\b/.test(words) || /^6\W*$/.test(words)) return pick(5);
  if (/\b(last|latest)\b/.test(words)) return count - 1;
  return undefined;
}

/** How many words a message has. */
function wordCount(text: string): number {
  return text.trim().split(/\s+/).length;
}

/** A short yes ("yes", "book it", "sounds good"). */
export function isYes(text: string): boolean {
  const words = plain(text);
  if (wordCount(words) > 6 || /\b(no|not|don't|dont)\b/.test(words)) return false;
  return /\b(yes|yep|yeah|yea|sure|ok|okay|confirm|confirmed|book it|book me|go ahead|do it|please do|sounds good|perfect|that works|works|deal|let's do it|lets do it)\b/.test(
    words,
  );
}

/** A short no, or a wish for another time ("no", "something later", "another one"). */
export function isNo(text: string): boolean {
  const words = plain(text);
  if (wordCount(words) > 8) return false;
  return /\b(no|nope|none|neither|nothing|different|other|else|later|another)\b/.test(words);
}

/** Thanks or a goodbye. */
export function isThanks(text: string): boolean {
  return /\b(thanks|thank you|thx|cheers|bye|see you)\b/.test(plain(text));
}

/** "How long is it?" */
export function isLengthQuestion(text: string): boolean {
  return /\bhow long\b|\bhow many (?:minutes|mins)\b|\bduration\b/.test(plain(text));
}

/** "Where is it?", "is it a video call?" */
export function isWhereQuestion(text: string): boolean {
  return /\bwhere\b|\blocation\b|\baddress\b|\bonline\b|\bin person\b|\bvideo\b|\bzoom\b|\bgoogle meet\b|\bphone call\b|\bon the phone\b/.test(
    plain(text),
  );
}

/** "Can I cancel?", "what if I need to reschedule?": never when the message names a clock time. */
export function isChangeQuestion(text: string): boolean {
  const words = plain(text);
  if (/\d\s*(?::|am|pm)/.test(words)) return false;
  return (
    /\b(cancel\w*|reschedul\w*)\b/.test(words) ||
    /\b(move|change)\b[^.?!]*\b(booking|appointment|meeting)\b/.test(words)
  );
}

/** "What's open?", "any times?" */
export function isOpenQuestion(text: string): boolean {
  return /\b(available|availability|open|openings|options|times|slots|when|free|schedule)\b/.test(plain(text));
}
