import type { CalendarDate } from '@internationalized/date';
import {
  TextAlignStart, ArrowUpDown, AtSign, CalendarCheck, CalendarDays, SquareChevronDown, CircleDot, MapPin, Paperclip, PenLine,
  Phone, SquareCheck, Star, Type, Globe, Hash, SquareCheckBig, ToggleLeft, Flag, Clock, CalendarClock, Gauge, EyeOff, ShieldCheck, TextQuote, type LucideIcon,
} from 'lucide-react';
import { PHONE_COUNTRIES, phoneToString, type PhoneValue } from '../PhoneField/PhoneField.tsx';
import { formatClockRange } from '../WeekCalendar/clock.ts';

/** Every answer type a Timefix form can ask. */
export type QuestionKind =
  | 'short' | 'long' | 'email' | 'phone' | 'choice' | 'multi' | 'dropdown' | 'rating'
  | 'date' | 'file' | 'address' | 'ranking' | 'signature' | 'booking'
  | 'url' | 'number' | 'checkbox' | 'yesno' | 'country' | 'time' | 'datetime' | 'scale' | 'hidden' | 'consent' | 'statement';

/** The name and icon of each answer type, shared by the hosted form, the builder's list and the type picker. */
export const QUESTION_KINDS: Readonly<Record<QuestionKind, { readonly label: string; readonly icon: LucideIcon; readonly hint: string }>> = {
  short: { label: 'Short answer', icon: Type, hint: 'One line of text' },
  long: { label: 'Long answer', icon: TextAlignStart, hint: 'A paragraph' },
  email: { label: 'Email', icon: AtSign, hint: 'Checked as typed' },
  phone: { label: 'Phone', icon: Phone, hint: 'With country code' },
  choice: { label: 'Single choice', icon: CircleDot, hint: 'Pick one card' },
  multi: { label: 'Multiple choice', icon: SquareCheck, hint: 'Pick any cards' },
  dropdown: { label: 'Dropdown', icon: SquareChevronDown, hint: 'A long list' },
  rating: { label: 'Rating', icon: Star, hint: 'One to five stars' },
  date: { label: 'Date', icon: CalendarDays, hint: 'A calendar' },
  file: { label: 'File upload', icon: Paperclip, hint: 'Up to 10 MB' },
  address: { label: 'Address', icon: MapPin, hint: 'Street to country' },
  ranking: { label: 'Ranking', icon: ArrowUpDown, hint: 'Drag into order' },
  signature: { label: 'Signature', icon: PenLine, hint: 'Draw or type' },
  booking: { label: 'Book a time', icon: CalendarCheck, hint: 'A meeting slot' },
  url: { label: 'Website', icon: Globe, hint: 'A link, checked' },
  number: { label: 'Number', icon: Hash, hint: 'With a lowest and highest' },
  checkbox: { label: 'Checkbox', icon: SquareCheckBig, hint: 'One tick box' },
  yesno: { label: 'Yes or no', icon: ToggleLeft, hint: 'Two big buttons' },
  country: { label: 'Country', icon: Flag, hint: 'Searchable list' },
  time: { label: 'Time', icon: Clock, hint: 'Hours and minutes' },
  datetime: { label: 'Date and time', icon: CalendarClock, hint: 'A day and a time' },
  scale: { label: 'Scale', icon: Gauge, hint: '0 to 10, with end words' },
  hidden: { label: 'Hidden field', icon: EyeOff, hint: 'Filled from the link' },
  consent: { label: 'Consent', icon: ShieldCheck, hint: 'Terms or marketing' },
  statement: { label: 'Statement', icon: TextQuote, hint: 'Text, no answer' },
};

/** The type picker's sections, in the order people look for them. */
export const QUESTION_GROUPS: ReadonlyArray<{ readonly title: string; readonly kinds: ReadonlyArray<QuestionKind> }> = [
  { title: 'Text', kinds: ['short', 'long', 'email', 'phone', 'url', 'number', 'address'] },
  { title: 'Choices', kinds: ['choice', 'multi', 'yesno', 'dropdown', 'country', 'checkbox', 'ranking'] },
  { title: 'Scores', kinds: ['rating', 'scale'] },
  { title: 'Dates and times', kinds: ['date', 'time', 'datetime', 'booking'] },
  { title: 'Files and agreement', kinds: ['file', 'signature', 'consent'] },
  { title: 'Layout and data', kinds: ['statement', 'hidden'] },
];

/** Countries a Country question offers, nearest markets first. */
export const COUNTRIES: ReadonlyArray<string> = ['India', 'United Arab Emirates', 'United Kingdom', 'United States', 'Singapore', 'Australia', 'Canada', 'Germany', 'France', 'Netherlands', 'Saudi Arabia', 'Qatar', 'Sri Lanka', 'Nepal', 'Bangladesh', 'Japan', 'Spain', 'Italy', 'Ireland', 'New Zealand', 'South Africa', 'Kenya', 'Brazil', 'Mexico'];

/** One question of a form. `options` feeds choice, multi, dropdown and ranking. */
export interface FormQuestion {
  readonly id: string;
  readonly kind: QuestionKind;
  readonly title: string;
  readonly description?: string;
  readonly required?: boolean;
  readonly placeholder?: string;
  readonly options?: ReadonlyArray<string>;
  /** Number and Scale: the lowest and highest allowed (Scale defaults to 0 to 10). */
  readonly min?: number; readonly max?: number;
  /** Scale: the words under each end ("Not likely", "Very likely"). */
  readonly low?: string; readonly high?: string;
  /** Hidden: the value sent when the link doesn't carry one. Checkbox and Consent: the words beside the box. */
  readonly defaultValue?: string;
  /** Consent: terms (required to go on) or marketing (optional). */
  readonly consentKind?: 'terms' | 'marketing';
  /** Shown only when an earlier question's answer is this; its answer isn't kept when it's skipped. */
  readonly showIf?: { readonly questionId: string; readonly is: string };
  /** Starts a new step (a page of the form) at this question, with the step's title. */
  readonly step?: { readonly title?: string };
  /** After this question, by answer: go to another question's id, 'end' (the thank you), or 'end:<ending id>' (another thank-you message).
   *  An `is` of '*' is the Otherwise line: where everyone else goes. */
  readonly jumps?: ReadonlyArray<{ readonly is: string; readonly to: string }>;
  /** Points each choice gives; the answers' total is the score. */
  readonly points?: Readonly<Record<string, number>>;
  /** Counts as "How did you hear about us" in Insights. */
  readonly insights?: boolean;
  /** The record field the answer fills ("person.title"); unset keeps it with the submission only. */
  readonly saveTo?: string;
  /** With Save answer to: a new answer replaces what the record already has (on), or only fills it when empty (off, the default). */
  readonly overwrite?: boolean;
  /** Date: the earliest and latest day a visitor can pick: 'today', or a day as YYYY-MM-DD. */
  readonly earliest?: string; readonly latest?: string;
  /** Multiple choice: the fewest and most picks allowed. */
  readonly fewest?: number; readonly most?: number;
  /** Single and multiple choice: an "Other" card that opens a line to type in. */
  readonly other?: boolean;
}

/** What "Other" sends: the typed words after this prefix ("Other: a podcast"). */
export const OTHER_PREFIX = 'Other: ';
/** A date bound as YYYY-MM-DD: 'today' is today's date. */
export function dayBound(b: string | undefined): string | undefined {
  if (!b) return undefined;
  if (b !== 'today') return /^\d{4}-\d{2}-\d{2}$/.test(b) ? b : undefined;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A postal address, each part as typed. */
export interface AddressValue { readonly street: string; readonly apartment: string; readonly city: string; readonly postcode: string; readonly country: string }
/** A file the visitor attached; `progress` is set while it uploads. */
export interface FileAnswer { readonly id: string; readonly name: string; readonly size: number; readonly type: string; readonly progress?: number }
/** A booked slot: an ISO date and minutes from midnight. */
export interface BookingAnswer { readonly date: string; readonly minutes: number }

/** Any answer. Signature answers are a PNG data URL (drawn) or the typed name. */
export type AnswerValue = string | number | ReadonlyArray<string> | PhoneValue | AddressValue | ReadonlyArray<FileAnswer> | BookingAnswer;
/** The visitor's answers by question id. */
export type FormAnswers = Readonly<Record<string, AnswerValue | undefined>>;

/** Where a booking question's open times come from; nothing here fetches. */
export interface BookingSource {
  readonly durationMinutes: number;
  readonly today: CalendarDate;
  readonly isDayOpen: (date: CalendarDate) => boolean;
  /** Open start times of a day, as minutes from midnight. */
  readonly slotsFor: (date: CalendarDate) => ReadonlyArray<number>;
}

export const isText = (v: AnswerValue | undefined): v is string => typeof v === 'string';
export const isList = (v: AnswerValue | undefined): v is ReadonlyArray<string> => Array.isArray(v) && v.every((x) => typeof x === 'string');
export const isFiles = (v: AnswerValue | undefined): v is ReadonlyArray<FileAnswer> => Array.isArray(v) && v.every((x) => typeof x === 'object');
export const isPhone = (v: AnswerValue | undefined): v is PhoneValue => typeof v === 'object' && v !== null && 'national' in v;
export const isAddress = (v: AnswerValue | undefined): v is AddressValue => typeof v === 'object' && v !== null && 'street' in v;
export const isBooking = (v: AnswerValue | undefined): v is BookingAnswer => typeof v === 'object' && v !== null && 'minutes' in v;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function isEmpty(q: FormQuestion, v: AnswerValue | undefined): boolean {
  if (q.kind === 'statement' || q.kind === 'hidden') return false;
  if (v === undefined) return q.kind !== 'ranking';
  if (isText(v)) return v.trim() === '';
  if (isPhone(v)) return v.national === '';
  if (isAddress(v)) return v.street.trim() === '' && v.city.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** What is wrong with an answer, as the visitor reads it, or undefined when it can go. */
export function checkAnswer(q: FormQuestion, v: AnswerValue | undefined): string | undefined {
  if (isEmpty(q, v)) {
    if (!q.required) return undefined;
    if (q.kind === 'choice' || q.kind === 'dropdown' || q.kind === 'rating' || q.kind === 'yesno' || q.kind === 'scale' || q.kind === 'country') return 'Pick one to go on.';
    if (q.kind === 'checkbox' || q.kind === 'consent') return 'Tick the box to go on.';
    if (q.kind === 'datetime') return 'Pick a day and a time to go on.';
    if (q.kind === 'multi') return 'Pick at least one to go on.';
    if (q.kind === 'booking') return 'Pick a time to go on.';
    if (q.kind === 'signature') return 'Sign to go on.';
    if (q.kind === 'file') return 'Attach a file to go on.';
    return 'This one needs an answer.';
  }
  if (q.kind === 'email' && isText(v) && !EMAIL.test(v.trim())) return 'That email looks incomplete, like name@company.com.';
  if (q.kind === 'phone' && isPhone(v) && v.national.length < 6) return 'That number looks short.';
  if (q.kind === 'address' && isAddress(v) && (v.street.trim() === '' || v.city.trim() === '')) return 'Add the street and the city.';
  if (q.kind === 'file' && isFiles(v) && v.some((f) => f.progress !== undefined)) return 'Wait for the upload to finish.';
  if (q.kind === 'url' && isText(v) && !/^(https?:\/\/)?[^\s/.]+(\.[^\s/.]+)+(\/\S*)?$/i.test(v.trim())) return 'That link looks incomplete, like example.com.';
  if (q.kind === 'number' && isText(v)) {
    const n = Number(v.replace(/,/g, ''));
    if (!Number.isFinite(n)) return 'Type a number, like 12 or 3.5.';
    if (q.min !== undefined && n < q.min) return `The lowest is ${q.min}.`;
    if (q.max !== undefined && n > q.max) return `The highest is ${q.max}.`;
  }
  if (q.kind === 'datetime' && isText(v) && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return 'Pick both a day and a time.';
  if (q.kind === 'date' && isText(v)) {
    const lo = dayBound(q.earliest); const hi = dayBound(q.latest);
    if (lo && v < lo) return q.earliest === 'today' ? 'Pick today or a day to come.' : `Pick ${dateLabel(lo)} or later.`;
    if (hi && v > hi) return `Pick ${dateLabel(hi)} or earlier.`;
  }
  if (q.kind === 'multi' && isList(v)) {
    if (v.some((x) => x === OTHER_PREFIX.trim() || x === OTHER_PREFIX)) return 'Say what “Other” is, or untick it.';
    if (q.fewest !== undefined && v.length < q.fewest) return `Pick at least ${q.fewest}.`;
    if (q.most !== undefined && v.length > q.most) return `Pick at most ${q.most}.`;
  }
  if (q.kind === 'choice' && isText(v) && (v === OTHER_PREFIX || v === OTHER_PREFIX.trim())) return 'Say what “Other” is, or pick another.';
  return undefined;
}

const timeLabel = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, h ?? 0, m ?? 0)); };
const dateLabel = (iso: string) => new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${iso}T00:00`));

/** An answer read back as one line for the sent answers and the builder's results. */
export function answerText(q: FormQuestion, v: AnswerValue | undefined, booking?: BookingSource): string {
  if (q.kind === 'ranking') return (isList(v) ? v : q.options ?? []).map((o, i) => `${i + 1}. ${o}`).join('  ');
  if (v === undefined) return '';
  if (q.kind === 'signature' && isText(v)) return v.startsWith('data:') ? 'Signed' : v ? `Signed as ${v}` : '';
  if (q.kind === 'rating' && typeof v === 'number') return `${v} of 5`;
  if (q.kind === 'scale' && typeof v === 'number') return `${v} of ${q.max ?? 10}`;
  if ((q.kind === 'checkbox' || q.kind === 'consent') && isText(v)) return v ? 'Yes' : '';
  if (q.kind === 'time' && isText(v)) return v ? timeLabel(v) : '';
  if (q.kind === 'datetime' && isText(v)) return v.includes('T') ? `${dateLabel(v.slice(0, 10))}, ${timeLabel(v.slice(11, 16))}` : '';
  if (q.kind === 'statement') return '';
  if (q.kind === 'date' && isText(v)) return v ? dateLabel(v) : '';
  if (isText(v)) return v.trim();
  if (typeof v === 'number') return String(v);
  if (isPhone(v)) return v.national ? phoneToString(v, PHONE_COUNTRIES) : '';
  if (isAddress(v)) return [v.street, v.apartment, v.city, v.postcode, v.country].map((s) => s.trim()).filter(Boolean).join(', ');
  if (isBooking(v)) return `${dateLabel(v.date)}, ${formatClockRange(v.minutes, v.minutes + (booking?.durationMinutes ?? 30))}`;
  if (isFiles(v)) return v.map((f) => f.name).join(', ');
  if (isList(v)) return v.join(', ');
  return '';
}
