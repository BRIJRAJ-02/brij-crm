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

/** Each listed country's ISO code, so its name can be said in the form's language. */
const COUNTRY_CODES: Readonly<Record<string, string>> = {
  India: 'IN', 'United Arab Emirates': 'AE', 'United Kingdom': 'GB', 'United States': 'US', Singapore: 'SG', Australia: 'AU', Canada: 'CA', Germany: 'DE', France: 'FR', Netherlands: 'NL',
  'Saudi Arabia': 'SA', Qatar: 'QA', 'Sri Lanka': 'LK', Nepal: 'NP', Bangladesh: 'BD', Japan: 'JP', Spain: 'ES', Italy: 'IT', Ireland: 'IE', 'New Zealand': 'NZ', 'South Africa': 'ZA', Kenya: 'KE', Brazil: 'BR', Mexico: 'MX',
};
/** A region's name in a locale (Intl.DisplayNames), or undefined when the browser has none. */
export function regionName(code: string, locale: string): string | undefined {
  try { return new Intl.DisplayNames([locale], { type: 'region' }).of(code); } catch { return undefined; }
}
/** A listed country's name in the form's language; the English name is the answer that is sent and stored. Other words stay as written. */
export function countryName(name: string, lang: FormLang): string {
  const code = COUNTRY_CODES[name];
  return lang === 'en' || !code ? name : regionName(code, LOCALE[lang]) ?? name;
}
/** The Country question's choices: English keeps nearest markets first; other languages sort by the translated name with that locale's collator. */
export function countryChoices(lang: FormLang): ReadonlyArray<{ readonly id: string; readonly label: string }> {
  const list = COUNTRIES.map((c) => ({ id: c, label: countryName(c, lang) }));
  if (lang === 'en') return list;
  const collator = new Intl.Collator(LOCALE[lang]);
  return [...list].sort((a, b) => collator.compare(a.label, b.label));
}

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

/** The languages a form speaks to its visitors: its buttons, steps and answer checks. */
export type FormLang = 'en' | 'hi' | 'es' | 'fr' | 'de';
/** The answer checks' words in one language. */
interface CheckWords {
  readonly pickOne: string; readonly tick: string; readonly dayTime: string; readonly atLeastOne: string; readonly slot: string; readonly sign: string; readonly attach: string; readonly needed: string;
  readonly email: string; readonly phone: string; readonly address: string; readonly upload: string; readonly fileType: string; readonly fileSize: string; readonly url: string; readonly number: string;
  readonly lowest: (n: number) => string; readonly highest: (n: number) => string; readonly both: string; readonly fromToday: string; readonly orLater: (d: string) => string; readonly orEarlier: (d: string) => string;
  readonly otherMulti: string; readonly fewest: (n: number) => string; readonly most: (n: number) => string; readonly otherChoice: string;
}
/** Every answer check, in every language the form language select offers. */
export const CHECK_WORDS: Readonly<Record<FormLang, CheckWords>> = {
  en: {
    pickOne: 'Pick one to go on.', tick: 'Tick the box to go on.', dayTime: 'Pick a day and a time to go on.', atLeastOne: 'Pick at least one to go on.', slot: 'Pick a time to go on.', sign: 'Sign to go on.', attach: 'Attach a file to go on.', needed: 'This one needs an answer.',
    email: 'That email looks incomplete, like name@company.com.', phone: 'That number looks short.', address: 'Add the street and the city.', upload: 'Wait for the upload to finish.', fileType: 'Use a PDF, PNG or JPG.', fileSize: 'Keep each file under 10 MB.',
    url: 'That link looks incomplete, like example.com.', number: 'Type a number, like 12 or 3.5.', lowest: (n) => `The lowest is ${n}.`, highest: (n) => `The highest is ${n}.`, both: 'Pick both a day and a time.',
    fromToday: 'Pick today or a day to come.', orLater: (d) => `Pick ${d} or later.`, orEarlier: (d) => `Pick ${d} or earlier.`, otherMulti: 'Say what “Other” is, or untick it.', fewest: (n) => `Pick at least ${n}.`, most: (n) => `Pick at most ${n}.`, otherChoice: 'Say what “Other” is, or pick another.',
  },
  hi: {
    pickOne: 'आगे बढ़ने के लिए एक चुनें।', tick: 'आगे बढ़ने के लिए बॉक्स पर टिक करें।', dayTime: 'आगे बढ़ने के लिए दिन और समय चुनें।', atLeastOne: 'आगे बढ़ने के लिए कम से कम एक चुनें।', slot: 'आगे बढ़ने के लिए समय चुनें।', sign: 'आगे बढ़ने के लिए हस्ताक्षर करें।', attach: 'आगे बढ़ने के लिए फ़ाइल जोड़ें।', needed: 'इसका जवाब ज़रूरी है।',
    email: 'यह ईमेल अधूरा लगता है। ऐसे लिखें: name@company.com', phone: 'यह नंबर छोटा लगता है।', address: 'गली और शहर जोड़ें।', upload: 'अपलोड पूरा होने तक रुकें।', fileType: 'PDF, PNG या JPG फ़ाइल जोड़ें।', fileSize: 'हर फ़ाइल 10 MB से छोटी रखें।',
    url: 'यह लिंक अधूरा लगता है। ऐसे लिखें: example.com', number: 'कोई संख्या लिखें, जैसे 12 या 3.5।', lowest: (n) => `सबसे कम ${n} है।`, highest: (n) => `सबसे ज़्यादा ${n} है।`, both: 'दिन और समय दोनों चुनें।',
    fromToday: 'आज या आने वाला कोई दिन चुनें।', orLater: (d) => `${d} या उसके बाद का दिन चुनें।`, orEarlier: (d) => `${d} या उससे पहले का दिन चुनें।`, otherMulti: '“अन्य” क्या है, लिखें या उसका टिक हटाएँ।', fewest: (n) => `कम से कम ${n} चुनें।`, most: (n) => `ज़्यादा से ज़्यादा ${n} चुनें।`, otherChoice: '“अन्य” क्या है, लिखें या कोई दूसरा चुनें।',
  },
  es: {
    pickOne: 'Elige una para continuar.', tick: 'Marca la casilla para continuar.', dayTime: 'Elige un día y una hora para continuar.', atLeastOne: 'Elige al menos una para continuar.', slot: 'Elige una hora para continuar.', sign: 'Firma para continuar.', attach: 'Adjunta un archivo para continuar.', needed: 'Esta pregunta necesita una respuesta.',
    email: 'Ese correo parece incompleto; debe ser como nombre@empresa.com.', phone: 'Ese número parece corto.', address: 'Añade la calle y la ciudad.', upload: 'Espera a que termine la subida.', fileType: 'Usa un PDF, PNG o JPG.', fileSize: 'Cada archivo debe pesar menos de 10 MB.',
    url: 'Ese enlace parece incompleto, como ejemplo.com.', number: 'Escribe un número, como 12 o 3.5.', lowest: (n) => `El mínimo es ${n}.`, highest: (n) => `El máximo es ${n}.`, both: 'Elige un día y una hora.',
    fromToday: 'Elige hoy o un día futuro.', orLater: (d) => `Elige el ${d} o después.`, orEarlier: (d) => `Elige el ${d} o antes.`, otherMulti: 'Di qué es «Otro» o desmárcalo.', fewest: (n) => `Elige al menos ${n}.`, most: (n) => `Elige como máximo ${n}.`, otherChoice: 'Di qué es «Otro» o elige otra.',
  },
  fr: {
    pickOne: 'Choisissez-en une pour continuer.', tick: 'Cochez la case pour continuer.', dayTime: 'Choisissez un jour et une heure pour continuer.', atLeastOne: 'Choisissez-en au moins une pour continuer.', slot: 'Choisissez un horaire pour continuer.', sign: 'Signez pour continuer.', attach: 'Joignez un fichier pour continuer.', needed: 'Cette question demande une réponse.',
    email: 'Cet e-mail semble incomplet, par exemple nom@entreprise.com.', phone: 'Ce numéro semble trop court.', address: 'Ajoutez la rue et la ville.', upload: 'Attendez la fin de l’envoi.', fileType: 'Utilisez un PDF, PNG ou JPG.', fileSize: 'Chaque fichier doit faire moins de 10 Mo.',
    url: 'Ce lien semble incomplet, par exemple exemple.com.', number: 'Saisissez un nombre, comme 12 ou 3.5.', lowest: (n) => `Le minimum est ${n}.`, highest: (n) => `Le maximum est ${n}.`, both: 'Choisissez un jour et une heure.',
    fromToday: 'Choisissez aujourd’hui ou un jour à venir.', orLater: (d) => `Choisissez le ${d} ou après.`, orEarlier: (d) => `Choisissez le ${d} ou avant.`, otherMulti: 'Précisez « Autre » ou décochez-le.', fewest: (n) => `Choisissez-en au moins ${n}.`, most: (n) => `Choisissez-en au plus ${n}.`, otherChoice: 'Précisez « Autre » ou choisissez-en une autre.',
  },
  de: {
    pickOne: 'Wähle eine Antwort, um weiterzumachen.', tick: 'Setze das Häkchen, um weiterzumachen.', dayTime: 'Wähle Tag und Uhrzeit, um weiterzumachen.', atLeastOne: 'Wähle mindestens eine, um weiterzumachen.', slot: 'Wähle eine Uhrzeit, um weiterzumachen.', sign: 'Unterschreibe, um weiterzumachen.', attach: 'Hänge eine Datei an, um weiterzumachen.', needed: 'Diese Frage braucht eine Antwort.',
    email: 'Diese E-Mail wirkt unvollständig, etwa name@firma.de.', phone: 'Diese Nummer wirkt zu kurz.', address: 'Ergänze Straße und Ort.', upload: 'Warte, bis der Upload fertig ist.', fileType: 'Nutze ein PDF, PNG oder JPG.', fileSize: 'Jede Datei muss unter 10 MB bleiben.',
    url: 'Dieser Link wirkt unvollständig, etwa beispiel.de.', number: 'Gib eine Zahl ein, etwa 12 oder 3.5.', lowest: (n) => `Das Minimum ist ${n}.`, highest: (n) => `Das Maximum ist ${n}.`, both: 'Wähle Tag und Uhrzeit.',
    fromToday: 'Wähle heute oder einen späteren Tag.', orLater: (d) => `Wähle ${d} oder später.`, orEarlier: (d) => `Wähle ${d} oder früher.`, otherMulti: 'Sag, was „Sonstiges“ ist, oder entferne das Häkchen.', fewest: (n) => `Wähle mindestens ${n}.`, most: (n) => `Wähle höchstens ${n}.`, otherChoice: 'Sag, was „Sonstiges“ ist, oder wähle etwas anderes.',
  },
};
/** Each language's date words ("Fri 14 Nov"). */
const LOCALE: Readonly<Record<FormLang, string>> = { en: 'en-US', hi: 'hi-IN', es: 'es-ES', fr: 'fr-FR', de: 'de-DE' };
/** The words a guest reads around the questions in one language: placeholders, hints, Other, the file drop, the pickers, Finish later. */
export interface GuestWords {
  readonly typeAnswer: string; readonly newLine: string; readonly phone: string; readonly aNumber: string; readonly range: (a: number, b: number) => string;
  readonly yes: string; readonly no: string; readonly agree: string; readonly news: string; readonly notLikely: string; readonly veryLikely: string;
  readonly other: string; readonly otherLabel: string; readonly typeOwn: string;
  readonly pickExactly: (n: number) => string; readonly pickRange: (a: number, b: number) => string; readonly pickUpTo: (n: number) => string; readonly pickAtLeast: (n: number) => string; readonly pickAny: string; readonly pressLetter: string;
  readonly choose: string; readonly stars: readonly [string, string, string, string, string]; readonly ofFive: (n: number, word: string) => string;
  readonly openCalendar: string; readonly calendar: string; readonly time: string; readonly dropFile: string; readonly fileHint: string; readonly attached: string;
  readonly street: string; readonly apartment: string; readonly optional: string; readonly city: string; readonly postcode: string; readonly country: string;
  readonly move: (o: string) => string; readonly howSign: string; readonly draw: string; readonly type: string; readonly clear: string; readonly signHere: string; readonly pad: string; readonly fullName: string;
  readonly day: string; readonly openTimes: (day: string) => string; readonly noTimes: string;
  readonly finishLater: string; readonly saving: string; readonly saveFailed: string; readonly saved: string; readonly copyLink: string; readonly copied: string; readonly copyFailed: (link: string) => string;
  readonly sendFailed: string; readonly thanksLine: string; readonly progress: string; readonly required: string;
  /** The phone's country list: the chip's name, the search's name and placeholder, and the empty line. */
  readonly countryCode: string; readonly searchCountries: string; readonly countryOrCode: string; readonly noCountry: string;
  /** The sent answers read back: a signature, and a score out of its most. */
  readonly signed: string; readonly signedAs: (name: string) => string; readonly outOf: (n: number, most: number) => string;
}
/** The guest's words around the questions, in every language the form language select offers. The owner's own words stay as written. */
export const GUEST_WORDS: Readonly<Record<FormLang, GuestWords>> = {
  en: {
    typeAnswer: 'Type your answer', newLine: 'Shift + Enter for a new line', phone: 'Phone number', aNumber: 'A number', range: (a, b) => `${a} to ${b}`,
    yes: 'Yes', no: 'No', agree: 'I agree to the terms', news: 'Yes, email me news and offers', notLikely: 'Not likely', veryLikely: 'Very likely',
    other: 'Other', otherLabel: 'Other, in your words', typeOwn: 'Type your own',
    pickExactly: (n) => `Pick ${n}.`, pickRange: (a, b) => `Pick ${a} to ${b}.`, pickUpTo: (n) => `Pick up to ${n}.`, pickAtLeast: (n) => `Pick at least ${n}.`, pickAny: 'Pick as many as fit.', pressLetter: 'Press a letter to pick.',
    choose: 'Choose…', stars: ['Poor', 'Fair', 'Good', 'Great', 'Excellent'], ofFive: (n, w) => `${n} of 5, ${w}`,
    openCalendar: 'Open calendar', calendar: 'Calendar', time: 'Time', dropFile: 'Drop a file or browse', fileHint: 'PDF, PNG or JPG, up to 10 MB', attached: 'Attached files',
    street: 'Street', apartment: 'Apartment', optional: 'Optional', city: 'City', postcode: 'Postcode', country: 'Country',
    move: (o) => `Move ${o}`, howSign: 'How to sign', draw: 'Draw', type: 'Type', clear: 'Clear', signHere: 'Sign here', pad: 'Signature pad. Draw with a pointer, or switch to Type.', fullName: 'Your full name',
    day: 'Day', openTimes: (d) => `Open times on ${d}`, noTimes: 'No times left on this day.',
    finishLater: 'Finish later', saving: 'Saving…', saveFailed: 'Couldn’t save. Try again', saved: 'Saved. Your answers wait for you.', copyLink: 'Copy link', copied: 'Copied', copyFailed: (l) => `Copy didn’t work. Select this link and copy it: ${l}`,
    sendFailed: 'We couldn’t send that. Check your connection and try again.', thanksLine: 'Your answers are in. You can close this page.', progress: 'Progress', required: 'required',
    countryCode: 'Country code', searchCountries: 'Search countries', countryOrCode: 'Country or code', noCountry: 'No country matches.',
    signed: 'Signed', signedAs: (n) => `Signed as ${n}`, outOf: (n, m) => `${n} of ${m}`,
  },
  hi: {
    typeAnswer: 'अपना जवाब लिखें', newLine: 'नई लाइन के लिए Shift + Enter', phone: 'फ़ोन नंबर', aNumber: 'कोई संख्या', range: (a, b) => `${a} से ${b}`,
    yes: 'हाँ', no: 'नहीं', agree: 'मैं शर्तों से सहमत हूँ', news: 'हाँ, मुझे खबरें और ऑफ़र ईमेल करें', notLikely: 'संभावना नहीं', veryLikely: 'बहुत संभावना',
    other: 'अन्य', otherLabel: 'अन्य, अपने शब्दों में', typeOwn: 'अपना जवाब लिखें',
    pickExactly: (n) => `${n} चुनें।`, pickRange: (a, b) => `${a} से ${b} चुनें।`, pickUpTo: (n) => `ज़्यादा से ज़्यादा ${n} चुनें।`, pickAtLeast: (n) => `कम से कम ${n} चुनें।`, pickAny: 'जितने ठीक लगें, चुनें।', pressLetter: 'चुनने के लिए अक्षर दबाएँ।',
    choose: 'चुनें…', stars: ['खराब', 'ठीक-ठाक', 'अच्छा', 'बहुत अच्छा', 'शानदार'], ofFive: (n, w) => `5 में से ${n}, ${w}`,
    openCalendar: 'कैलेंडर खोलें', calendar: 'कैलेंडर', time: 'समय', dropFile: 'फ़ाइल यहाँ छोड़ें या चुनें', fileHint: 'PDF, PNG या JPG, 10 MB तक', attached: 'जुड़ी फ़ाइलें',
    street: 'गली', apartment: 'फ़्लैट', optional: 'वैकल्पिक', city: 'शहर', postcode: 'पिन कोड', country: 'देश',
    move: (o) => `${o} को खिसकाएँ`, howSign: 'हस्ताक्षर का तरीका', draw: 'बनाएँ', type: 'लिखें', clear: 'मिटाएँ', signHere: 'यहाँ हस्ताक्षर करें', pad: 'हस्ताक्षर पैड। पॉइंटर से बनाएँ, या लिखें चुनें।', fullName: 'आपका पूरा नाम',
    day: 'दिन', openTimes: (d) => `${d} को खाली समय`, noTimes: 'इस दिन कोई समय नहीं बचा।',
    finishLater: 'बाद में पूरा करें', saving: 'सहेज रहे हैं…', saveFailed: 'सहेजा नहीं जा सका। फिर कोशिश करें', saved: 'सहेज लिया। आपके जवाब आपका इंतज़ार करेंगे।', copyLink: 'लिंक कॉपी करें', copied: 'कॉपी हो गया', copyFailed: (l) => `कॉपी नहीं हुआ। यह लिंक चुनकर कॉपी करें: ${l}`,
    sendFailed: 'हम इसे भेज नहीं पाए। अपना कनेक्शन जाँचें और फिर कोशिश करें।', thanksLine: 'आपके जवाब मिल गए। अब आप यह पेज बंद कर सकते हैं।', progress: 'प्रगति', required: 'ज़रूरी',
    countryCode: 'देश का कोड', searchCountries: 'देश खोजें', countryOrCode: 'देश या कोड', noCountry: 'कोई देश नहीं मिला।',
    signed: 'हस्ताक्षर किए', signedAs: (n) => `${n} के नाम से हस्ताक्षर`, outOf: (n, m) => `${m} में से ${n}`,
  },
  es: {
    typeAnswer: 'Escribe tu respuesta', newLine: 'Mayús + Intro para una línea nueva', phone: 'Número de teléfono', aNumber: 'Un número', range: (a, b) => `${a} a ${b}`,
    yes: 'Sí', no: 'No', agree: 'Acepto los términos', news: 'Sí, enviadme noticias y ofertas', notLikely: 'Poco probable', veryLikely: 'Muy probable',
    other: 'Otro', otherLabel: 'Otro, con tus palabras', typeOwn: 'Escribe el tuyo',
    pickExactly: (n) => `Elige ${n}.`, pickRange: (a, b) => `Elige de ${a} a ${b}.`, pickUpTo: (n) => `Elige hasta ${n}.`, pickAtLeast: (n) => `Elige al menos ${n}.`, pickAny: 'Elige todas las que quieras.', pressLetter: 'Pulsa una letra para elegir.',
    choose: 'Elige…', stars: ['Malo', 'Regular', 'Bueno', 'Muy bueno', 'Excelente'], ofFive: (n, w) => `${n} de 5, ${w}`,
    openCalendar: 'Abrir calendario', calendar: 'Calendario', time: 'Hora', dropFile: 'Suelta un archivo o búscalo', fileHint: 'PDF, PNG o JPG, hasta 10 MB', attached: 'Archivos adjuntos',
    street: 'Calle', apartment: 'Piso', optional: 'Opcional', city: 'Ciudad', postcode: 'Código postal', country: 'País',
    move: (o) => `Mover ${o}`, howSign: 'Cómo firmar', draw: 'Dibujar', type: 'Escribir', clear: 'Borrar', signHere: 'Firma aquí', pad: 'Área de firma. Dibuja con el puntero o cambia a Escribir.', fullName: 'Tu nombre completo',
    day: 'Día', openTimes: (d) => `Horas libres el ${d}`, noTimes: 'No quedan horas este día.',
    finishLater: 'Terminar más tarde', saving: 'Guardando…', saveFailed: 'No se pudo guardar. Inténtalo de nuevo', saved: 'Guardado. Tus respuestas te esperan.', copyLink: 'Copiar enlace', copied: 'Copiado', copyFailed: (l) => `No se pudo copiar. Selecciona este enlace y cópialo: ${l}`,
    sendFailed: 'No pudimos enviarlo. Revisa tu conexión e inténtalo de nuevo.', thanksLine: 'Tus respuestas han llegado. Ya puedes cerrar esta página.', progress: 'Progreso', required: 'obligatoria',
    countryCode: 'Prefijo del país', searchCountries: 'Buscar países', countryOrCode: 'País o prefijo', noCountry: 'Ningún país coincide.',
    signed: 'Firmado', signedAs: (n) => `Firmado como ${n}`, outOf: (n, m) => `${n} de ${m}`,
  },
  fr: {
    typeAnswer: 'Saisissez votre réponse', newLine: 'Maj + Entrée pour une nouvelle ligne', phone: 'Numéro de téléphone', aNumber: 'Un nombre', range: (a, b) => `${a} à ${b}`,
    yes: 'Oui', no: 'Non', agree: 'J’accepte les conditions', news: 'Oui, envoyez-moi les actualités et les offres', notLikely: 'Peu probable', veryLikely: 'Très probable',
    other: 'Autre', otherLabel: 'Autre, avec vos mots', typeOwn: 'Saisissez la vôtre',
    pickExactly: (n) => `Choisissez-en ${n}.`, pickRange: (a, b) => `Choisissez-en de ${a} à ${b}.`, pickUpTo: (n) => `Choisissez-en jusqu’à ${n}.`, pickAtLeast: (n) => `Choisissez-en au moins ${n}.`, pickAny: 'Choisissez-en autant que vous voulez.', pressLetter: 'Appuyez sur une lettre pour choisir.',
    choose: 'Choisir…', stars: ['Mauvais', 'Passable', 'Bien', 'Très bien', 'Excellent'], ofFive: (n, w) => `${n} sur 5, ${w}`,
    openCalendar: 'Ouvrir le calendrier', calendar: 'Calendrier', time: 'Heure', dropFile: 'Déposez un fichier ou parcourez', fileHint: 'PDF, PNG ou JPG, jusqu’à 10 Mo', attached: 'Fichiers joints',
    street: 'Rue', apartment: 'Appartement', optional: 'Facultatif', city: 'Ville', postcode: 'Code postal', country: 'Pays',
    move: (o) => `Déplacer ${o}`, howSign: 'Comment signer', draw: 'Dessiner', type: 'Saisir', clear: 'Effacer', signHere: 'Signez ici', pad: 'Zone de signature. Dessinez avec le pointeur, ou passez à Saisir.', fullName: 'Votre nom complet',
    day: 'Jour', openTimes: (d) => `Horaires libres le ${d}`, noTimes: 'Plus aucun horaire ce jour-là.',
    finishLater: 'Finir plus tard', saving: 'Enregistrement…', saveFailed: 'Échec de l’enregistrement. Réessayez', saved: 'Enregistré. Vos réponses vous attendent.', copyLink: 'Copier le lien', copied: 'Copié', copyFailed: (l) => `La copie n’a pas marché. Sélectionnez ce lien et copiez-le : ${l}`,
    sendFailed: 'Nous n’avons pas pu l’envoyer. Vérifiez votre connexion et réessayez.', thanksLine: 'Vos réponses sont arrivées. Vous pouvez fermer cette page.', progress: 'Progression', required: 'obligatoire',
    countryCode: 'Indicatif du pays', searchCountries: 'Rechercher un pays', countryOrCode: 'Pays ou indicatif', noCountry: 'Aucun pays ne correspond.',
    signed: 'Signé', signedAs: (n) => `Signé au nom de ${n}`, outOf: (n, m) => `${n} sur ${m}`,
  },
  de: {
    typeAnswer: 'Deine Antwort', newLine: 'Umschalt + Enter für eine neue Zeile', phone: 'Telefonnummer', aNumber: 'Eine Zahl', range: (a, b) => `${a} bis ${b}`,
    yes: 'Ja', no: 'Nein', agree: 'Ich stimme den Bedingungen zu', news: 'Ja, schickt mir Neuigkeiten und Angebote', notLikely: 'Unwahrscheinlich', veryLikely: 'Sehr wahrscheinlich',
    other: 'Sonstiges', otherLabel: 'Sonstiges, in deinen Worten', typeOwn: 'Eigene Antwort',
    pickExactly: (n) => `Wähle ${n}.`, pickRange: (a, b) => `Wähle ${a} bis ${b}.`, pickUpTo: (n) => `Wähle bis zu ${n}.`, pickAtLeast: (n) => `Wähle mindestens ${n}.`, pickAny: 'Wähle so viele, wie passen.', pressLetter: 'Drücke einen Buchstaben, um zu wählen.',
    choose: 'Auswählen…', stars: ['Schlecht', 'Mäßig', 'Gut', 'Sehr gut', 'Ausgezeichnet'], ofFive: (n, w) => `${n} von 5, ${w}`,
    openCalendar: 'Kalender öffnen', calendar: 'Kalender', time: 'Uhrzeit', dropFile: 'Datei ablegen oder durchsuchen', fileHint: 'PDF, PNG oder JPG, bis 10 MB', attached: 'Angehängte Dateien',
    street: 'Straße', apartment: 'Wohnung', optional: 'Optional', city: 'Ort', postcode: 'Postleitzahl', country: 'Land',
    move: (o) => `${o} verschieben`, howSign: 'Wie unterschreiben', draw: 'Zeichnen', type: 'Tippen', clear: 'Löschen', signHere: 'Hier unterschreiben', pad: 'Unterschriftenfeld. Zeichne mit dem Zeiger oder wechsle zu Tippen.', fullName: 'Dein vollständiger Name',
    day: 'Tag', openTimes: (d) => `Freie Zeiten am ${d}`, noTimes: 'An diesem Tag sind keine Zeiten mehr frei.',
    finishLater: 'Später fertig machen', saving: 'Wird gespeichert…', saveFailed: 'Speichern fehlgeschlagen. Nochmal versuchen', saved: 'Gespeichert. Deine Antworten warten auf dich.', copyLink: 'Link kopieren', copied: 'Kopiert', copyFailed: (l) => `Kopieren hat nicht geklappt. Markiere diesen Link und kopiere ihn: ${l}`,
    sendFailed: 'Wir konnten das nicht senden. Prüfe deine Verbindung und versuche es nochmal.', thanksLine: 'Deine Antworten sind da. Du kannst diese Seite schließen.', progress: 'Fortschritt', required: 'Pflichtfeld',
    countryCode: 'Ländervorwahl', searchCountries: 'Länder suchen', countryOrCode: 'Land oder Vorwahl', noCountry: 'Kein Land passt.',
    signed: 'Unterschrieben', signedAs: (n) => `Unterschrieben als ${n}`, outOf: (n, m) => `${n} von ${m}`,
  },
};
/** A language's locale, for dates and the pickers' month and day names. */
export const localeOf = (lang: FormLang): string => LOCALE[lang];
/** The files a File upload takes, and how big. */
const FILE_TYPES = /\.(pdf|png|jpe?g)$/i; const FILE_MAX = 10 * 1024 * 1024;

/** What is wrong with an answer, as the visitor reads it in the form's language, or undefined when it can go. */
export function checkAnswer(q: FormQuestion, v: AnswerValue | undefined, lang: FormLang = 'en'): string | undefined {
  const w = CHECK_WORDS[lang];
  if (isEmpty(q, v)) {
    if (!q.required) return undefined;
    if (q.kind === 'choice' || q.kind === 'dropdown' || q.kind === 'rating' || q.kind === 'yesno' || q.kind === 'scale' || q.kind === 'country') return w.pickOne;
    if (q.kind === 'checkbox' || q.kind === 'consent') return w.tick;
    if (q.kind === 'datetime') return w.dayTime;
    if (q.kind === 'multi') return w.atLeastOne;
    if (q.kind === 'booking') return w.slot;
    if (q.kind === 'signature') return w.sign;
    if (q.kind === 'file') return w.attach;
    return w.needed;
  }
  if (q.kind === 'email' && isText(v) && !EMAIL.test(v.trim())) return w.email;
  if (q.kind === 'phone' && isPhone(v) && v.national.length < 6) return w.phone;
  if (q.kind === 'address' && isAddress(v) && (v.street.trim() === '' || v.city.trim() === '')) return w.address;
  if (q.kind === 'file' && isFiles(v) && v.some((f) => f.progress !== undefined)) return w.upload;
  if (q.kind === 'file' && isFiles(v) && v.some((f) => !FILE_TYPES.test(f.name) && !/^(application\/pdf|image\/(png|jpe?g))$/.test(f.type))) return w.fileType;
  if (q.kind === 'file' && isFiles(v) && v.some((f) => f.size > FILE_MAX)) return w.fileSize;
  if (q.kind === 'url' && isText(v) && !/^(https?:\/\/)?[^\s/.]+(\.[^\s/.]+)+(\/\S*)?$/i.test(v.trim())) return w.url;
  if (q.kind === 'number' && isText(v)) {
    const n = Number(v.replace(/,/g, ''));
    if (!Number.isFinite(n)) return w.number;
    if (q.min !== undefined && n < q.min) return w.lowest(q.min);
    if (q.max !== undefined && n > q.max) return w.highest(q.max);
  }
  if (q.kind === 'datetime' && isText(v) && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return w.both;
  if (q.kind === 'date' && isText(v)) {
    const lo = dayBound(q.earliest); const hi = dayBound(q.latest);
    if (lo && v < lo) return q.earliest === 'today' ? w.fromToday : w.orLater(dateLabel(lo, lang));
    if (hi && v > hi) return w.orEarlier(dateLabel(hi, lang));
  }
  if (q.kind === 'multi' && isList(v)) {
    if (v.some((x) => x === OTHER_PREFIX.trim() || x === OTHER_PREFIX)) return w.otherMulti;
    if (q.fewest !== undefined && v.length < q.fewest) return w.fewest(q.fewest);
    if (q.most !== undefined && v.length > q.most) return w.most(q.most);
  }
  if (q.kind === 'choice' && isText(v) && (v === OTHER_PREFIX || v === OTHER_PREFIX.trim())) return w.otherChoice;
  return undefined;
}

const timeLabel = (hhmm: string, lang: FormLang = 'en') => { const [h, m] = hhmm.split(':').map(Number); return new Intl.DateTimeFormat(LOCALE[lang], { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, h ?? 0, m ?? 0)); };
const dateLabel = (iso: string, lang: FormLang = 'en') => new Intl.DateTimeFormat(LOCALE[lang], { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${iso}T00:00`));
const minutesLabel = (mins: number, lang: FormLang) => timeLabel(`${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`, lang);

/** An answer read back as one line for the sent answers and the builder's results, in the form's language (English when left out).
 *  Only the reading is translated: the answer itself (Yes, No, "Other: …", a country's English name) is sent and stored as it is. */
export function answerText(q: FormQuestion, v: AnswerValue | undefined, booking?: BookingSource, lang: FormLang = 'en'): string {
  const g = GUEST_WORDS[lang];
  if (q.kind === 'ranking') return (isList(v) ? v : q.options ?? []).map((o, i) => `${i + 1}. ${o}`).join('  ');
  if (v === undefined) return '';
  if (q.kind === 'signature' && isText(v)) return v.startsWith('data:') ? g.signed : v ? g.signedAs(v) : '';
  if (q.kind === 'rating' && typeof v === 'number') return g.outOf(v, 5);
  if (q.kind === 'scale' && typeof v === 'number') return g.outOf(v, q.max ?? 10);
  if ((q.kind === 'checkbox' || q.kind === 'consent') && isText(v)) return v ? g.yes : '';
  if (q.kind === 'yesno' && isText(v)) return v === 'Yes' ? g.yes : v === 'No' ? g.no : v.trim();
  if (q.kind === 'country' && isText(v)) return countryName(v.trim(), lang);
  if (q.kind === 'time' && isText(v)) return v ? timeLabel(v, lang) : '';
  if (q.kind === 'datetime' && isText(v)) return v.includes('T') ? `${dateLabel(v.slice(0, 10), lang)}, ${timeLabel(v.slice(11, 16), lang)}` : '';
  if (q.kind === 'statement') return '';
  if (q.kind === 'date' && isText(v)) return v ? dateLabel(v, lang) : '';
  const other = (x: string) => (x.startsWith(OTHER_PREFIX.trim()) ? `${g.other}: ${x.replace(/^Other:?\s?/, '')}` : x);
  if ((q.kind === 'choice' || q.kind === 'multi') && isText(v)) return other(v.trim());
  if (isText(v)) return v.trim();
  if (typeof v === 'number') return lang === 'en' ? String(v) : v.toLocaleString(LOCALE[lang]);
  if (isPhone(v)) return v.national ? phoneToString(v, PHONE_COUNTRIES) : '';
  if (isAddress(v)) return [v.street, v.apartment, v.city, v.postcode, v.country].map((s) => s.trim()).filter(Boolean).join(', ');
  if (isBooking(v)) { const end = v.minutes + (booking?.durationMinutes ?? 30); return `${dateLabel(v.date, lang)}, ${lang === 'en' ? formatClockRange(v.minutes, end) : `${minutesLabel(v.minutes, lang)} – ${minutesLabel(end, lang)}`}`; }
  if (isFiles(v)) return v.map((f) => f.name).join(', ');
  if (isList(v)) return (q.kind === 'multi' ? v.map(other) : v).join(', ');
  return '';
}
