import type { CalendarDate } from '@internationalized/date';
import {
  TextAlignStart, ArrowUpDown, AtSign, CalendarCheck, CalendarDays, SquareChevronDown, CircleDot, MapPin, Paperclip, PenLine,
  Phone, SquareCheck, Star, Type, type LucideIcon,
} from 'lucide-react';
import { PHONE_COUNTRIES, phoneToString, type PhoneValue } from '../PhoneField/PhoneField.tsx';
import { formatClockRange } from '../WeekCalendar/clock.ts';

/** Every answer type a Timefix form can ask. */
export type QuestionKind =
  | 'short' | 'long' | 'email' | 'phone' | 'choice' | 'multi' | 'dropdown' | 'rating'
  | 'date' | 'file' | 'address' | 'ranking' | 'signature' | 'booking';

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
};

/** One question of a form. `options` feeds choice, multi, dropdown and ranking. */
export interface FormQuestion {
  readonly id: string;
  readonly kind: QuestionKind;
  readonly title: string;
  readonly description?: string;
  readonly required?: boolean;
  readonly placeholder?: string;
  readonly options?: ReadonlyArray<string>;
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
    if (q.kind === 'choice' || q.kind === 'dropdown' || q.kind === 'rating') return 'Pick one to go on.';
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
  return undefined;
}

const dateLabel = (iso: string) => new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${iso}T00:00`));

/** An answer read back as one line for the sent answers and the builder's results. */
export function answerText(q: FormQuestion, v: AnswerValue | undefined, booking?: BookingSource): string {
  if (q.kind === 'ranking') return (isList(v) ? v : q.options ?? []).map((o, i) => `${i + 1}. ${o}`).join('  ');
  if (v === undefined) return '';
  if (q.kind === 'signature' && isText(v)) return v.startsWith('data:') ? 'Signed' : v ? `Signed as ${v}` : '';
  if (q.kind === 'rating' && typeof v === 'number') return `${v} of 5`;
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
