// The booking chat's agent (spec 0041): a rule based state machine ported from
// timefix's booking agent, pure, with no I/O. Every turn replays the visitor's
// own messages, in order, against the times open right now (AC-1517): nothing
// the assistant said earlier is read back as a fact, and a time taken since
// simply stops matching. `replay` folds the messages into a state; `answer`
// words the reply. Booking itself is the caller's (`chatTurn`), and happens
// only when the replay ends on a yes to the read back (AC-1514).
import type { PublicLocation } from '@crm/contracts';
import { DateTime } from 'luxon';
import {
  dayWord,
  isChangeQuestion,
  isLengthQuestion,
  isNo,
  isOpenQuestion,
  isThanks,
  isWhereQuestion,
  isYes,
  readBareName,
  readEmail,
  readIntroducedName,
  readLength,
  readPhone,
  readSelection,
  readTime,
} from './parse.ts';

/** How many times one reply puts on the table. */
export const OFFER_COUNT = 6;

/** What kind of turn the last message made. */
export type ChatIntent =
  | 'greet'
  | 'offer'
  | 'single-offer'
  | 'exact'
  | 'point-miss'
  | 'none-in-window'
  | 'select'
  | 'select-ambiguous'
  | 'confirm'
  | 'confirm-nothing'
  | 'reject-offer'
  | 'exhausted'
  | 'details'
  | 'availability'
  | 'thanks'
  | 'duration'
  | 'location'
  | 'change-policy'
  | 'length'
  | 'length-refused'
  | 'not-understood'
  | 'await-details'
  | 'await-confirm'
  | 'book';

/** The facts of the page the chat speaks for. */
export interface ChatPage {
  readonly title: string;
  readonly hostName: string;
  readonly durations: readonly number[];
  readonly location: PublicLocation;
}

/** Where a conversation stands after the visitor's messages. */
export interface ChatState {
  /** The times on the table, ISO starts, chronological. */
  readonly offered: readonly string[];
  /** The time being talked about. */
  readonly held?: string;
  /** The visitor chose `held` (an exact time, a pick or a yes), as opposed to it merely being the only offer. */
  readonly chosen: boolean;
  readonly name?: string;
  readonly email?: string;
  readonly phone?: string;
  /** The window the last time ask named, so "something later" and a length change stay on the subject. */
  readonly window?: { readonly start: number; readonly end: number; readonly phrase: string };
  readonly intent: ChatIntent;
  /** The last reply was the read back: a yes to the next message books. */
  readonly readBack: boolean;
  /** A length the visitor asked for that the page doesn't offer. */
  readonly refusedLength?: number;
}

/** What a turn needs besides the messages. */
export interface ChatContext {
  /** Open starts for the chosen length, ISO, chronological. */
  readonly slots: readonly string[];
  /** Now, in the visitor's zone. */
  readonly now: DateTime;
  /** How far ahead "asap" looks, in days. */
  readonly horizonDays: number;
  /** The page's location is a phone call: a number is asked for. */
  readonly needsPhone: boolean;
  /** Lengths the page offers. */
  readonly durations: readonly number[];
}

/** The state before any message. */
export const EMPTY_CHAT: ChatState = { offered: [], chosen: false, intent: 'greet', readBack: false };

const ms = (iso: string) => Date.parse(iso);

/** The `count` open starts nearest `to`, chronological. */
function nearest(slots: readonly string[], to: number, count = OFFER_COUNT): readonly string[] {
  return [...slots]
    .sort((a, b) => Math.abs(ms(a) - to) - Math.abs(ms(b) - to))
    .slice(0, count)
    .sort((a, b) => ms(a) - ms(b));
}

/** The soonest starts. */
function soonest(slots: readonly string[]): readonly string[] {
  return slots.slice(0, OFFER_COUNT);
}

/** Every detail a booking needs is in. */
export function isComplete(state: ChatState, needsPhone: boolean): boolean {
  return (
    state.held !== undefined &&
    state.chosen &&
    state.name !== undefined &&
    state.email !== undefined &&
    (!needsPhone || state.phone !== undefined)
  );
}

/**
 * The meeting length the conversation settles on: the last length the visitor
 * asked for that the page offers, else `fallback` (the rail's). Read before the
 * replay, since the open times depend on it.
 */
export function settledLength(messages: readonly string[], offered: readonly number[], fallback: number): number {
  return messages.reduce((length, message) => {
    const asked = readLength(message);
    return asked !== undefined && offered.includes(asked) ? asked : length;
  }, fallback);
}

/** One message's effect on the state. */
export function step(before: ChatState, text: string, context: ChatContext): ChatState {
  const { slots, now, horizonDays, needsPhone } = context;
  const confirming = before.readBack;
  let state: ChatState = { ...before, intent: 'greet', readBack: false };
  const { refusedLength: _refused, ...withoutRefusal } = state;
  state = withoutRefusal;
  const finish = (next: ChatState): ChatState => ({
    ...next,
    readBack: next.intent !== 'book' && isComplete(next, needsPhone),
  });

  // Who, before when: the details can ride along with anything else.
  const email = readEmail(text);
  if (email !== undefined) state = { ...state, email, intent: 'details' };
  const introduced = readIntroducedName(text);
  if (introduced !== undefined) state = { ...state, name: introduced, intent: 'details' };
  if (needsPhone && (state.held !== undefined || email !== undefined)) {
    const phone = readPhone(text);
    if (phone !== undefined) state = { ...state, phone, intent: 'details' };
  }

  // A length: the slots were read for the settled one already; this only says so, and drops a held time.
  const length = readLength(text);
  const ask = readTime(text, now, horizonDays);
  if (length !== undefined) {
    if (!context.durations.includes(length)) {
      state = { ...state, refusedLength: length, intent: 'length-refused' };
      if (ask === undefined) return finish(state);
    } else if (ask === undefined) {
      const { held: _held, ...rest } = state;
      const inWindow =
        state.window === undefined
          ? []
          : slots.filter((start) => ms(start) >= (state.window?.start ?? 0) && ms(start) < (state.window?.end ?? 0));
      return finish({
        ...rest,
        chosen: false,
        offered: inWindow.length > 0 ? inWindow.slice(0, OFFER_COUNT) : soonest(slots),
        intent: slots.length === 0 ? 'exhausted' : 'length',
      });
    }
  }

  // "Can I cancel?": before the time reader, since "can I move my Thursday booking" names a Thursday.
  if (isChangeQuestion(text)) {
    return finish({
      ...state,
      offered: state.offered.length > 0 ? state.offered : soonest(slots),
      intent: 'change-policy',
    });
  }

  if (ask !== undefined) {
    const { held: _held, window: _window, ...cleared } = state;
    if (ask.kind === 'point') {
      const at = ask.at.toMillis();
      // "3pm" with no day, while times are on the table: a pick among them.
      if (ask.dateImplied && state.offered.length > 0) {
        const matches = state.offered.filter((start) => {
          const local = DateTime.fromMillis(ms(start), { zone: now.zone });
          return local.hour === ask.at.hour && local.minute === ask.at.minute;
        });
        const [only] = matches;
        if (matches.length === 1 && only !== undefined)
          return finish({ ...state, held: only, chosen: true, intent: 'select' });
      }
      const exact = slots.find((start) => ms(start) === at);
      if (exact !== undefined)
        return finish({ ...cleared, held: exact, chosen: true, offered: [exact], intent: 'exact' });
      // A bare hour from 1 to 11 that missed in the morning means the afternoon ("tomorrow at 4").
      if (!ask.wroteMeridiem && ask.at.hour >= 1 && ask.at.hour <= 11) {
        const afternoon = ask.at.plus({ hours: 12 }).toMillis();
        const pm = slots.find((start) => ms(start) === afternoon);
        if (pm !== undefined) return finish({ ...cleared, held: pm, chosen: true, offered: [pm], intent: 'exact' });
      }
      const offered = nearest(slots, at);
      return finish({ ...cleared, chosen: false, offered, intent: offered.length > 0 ? 'point-miss' : 'exhausted' });
    }
    const start = ask.start.toMillis();
    const end = ask.end.toMillis();
    const inWindow = slots.filter((each) => ms(each) >= start && ms(each) < end).slice(0, OFFER_COUNT);
    const window = { start, end, phrase: ask.phrase };
    const [single] = inWindow;
    if (inWindow.length === 1 && single !== undefined) {
      return finish({ ...cleared, window, held: single, chosen: false, offered: inWindow, intent: 'single-offer' });
    }
    if (inWindow.length > 1) return finish({ ...cleared, window, chosen: false, offered: inWindow, intent: 'offer' });
    const offered = nearest(slots, start);
    return finish({
      ...cleared,
      window,
      chosen: false,
      offered,
      intent: offered.length > 0 ? 'none-in-window' : 'exhausted',
    });
  }

  const picked = readSelection(text, state.offered.length);
  if (picked !== undefined) {
    const held = state.offered[picked];
    if (held !== undefined) return finish({ ...state, held, chosen: true, intent: 'select' });
  }

  if (isYes(text)) {
    if (confirming && isComplete(state, needsPhone)) return { ...state, intent: 'book', readBack: false };
    if (state.held !== undefined) return finish({ ...state, chosen: true, intent: 'confirm' });
    const [only] = state.offered;
    if (state.offered.length === 1 && only !== undefined)
      return finish({ ...state, held: only, chosen: true, intent: 'confirm' });
    return finish({ ...state, intent: state.offered.length > 1 ? 'select-ambiguous' : 'confirm-nothing' });
  }

  if (isNo(text)) {
    const last = state.held ?? state.offered.at(-1);
    const after = last === undefined ? now.toMillis() : ms(last);
    const next = slots.filter((start) => ms(start) > after).slice(0, OFFER_COUNT);
    const { held: _held, ...rest } = state;
    return finish({ ...rest, chosen: false, offered: next, intent: next.length > 0 ? 'reject-offer' : 'exhausted' });
  }

  // Questions the page already answers; neither moves a booking on.
  if (isLengthQuestion(text)) {
    return finish({ ...state, offered: state.offered.length > 0 ? state.offered : soonest(slots), intent: 'duration' });
  }
  if (isWhereQuestion(text)) {
    return finish({ ...state, offered: state.offered.length > 0 ? state.offered : soonest(slots), intent: 'location' });
  }

  // A time is held and no name yet: a short message is likely the name.
  if (state.held !== undefined && state.name === undefined) {
    const bare = readBareName(text);
    if (bare !== undefined) return finish({ ...state, name: bare, intent: 'details' });
  }
  if (state.intent === 'details') {
    return finish({
      ...state,
      offered: state.offered.length > 0 || state.held !== undefined ? state.offered : soonest(slots),
    });
  }
  if (isThanks(text)) return finish({ ...state, intent: 'thanks' });
  if (isOpenQuestion(text)) {
    const offered = soonest(slots);
    const { held: _held, window: _window, ...rest } = state;
    return finish({ ...rest, chosen: false, offered, intent: offered.length > 0 ? 'availability' : 'exhausted' });
  }
  return finish({
    ...state,
    offered: state.offered.length > 0 ? state.offered : soonest(slots),
    intent: 'not-understood',
  });
}

/** The conversation after every visitor message, replayed in order. */
export function replay(messages: readonly string[], context: ChatContext): ChatState {
  return messages.reduce((state, message) => step(state, message, context), EMPTY_CHAT);
}

/** A turn's words: the sentence, the times as buttons, and what the visitor could say next. */
export interface ChatAnswer {
  readonly text: string;
  readonly offers: readonly string[];
  readonly suggestions: readonly string[];
}

/** The phrases offered as buttons; each one reads back through `step` as what it says. */
export const SAY = {
  later: 'Something later',
  nextWeek: 'Next week',
  earliest: 'Earliest you have',
  confirm: 'Yes, book it',
  somethingElse: 'Something else',
} as const;

/** How a reply says one time: "Tuesday at 3:00 PM". */
export function timeLabel(iso: string, now: DateTime, hour12: boolean): string {
  const at = DateTime.fromMillis(ms(iso), { zone: now.zone }).setLocale('en');
  return `${dayWord(at, now)} at ${at.toFormat(hour12 ? 'h:mm a' : 'HH:mm')}`;
}

/** The words a time button sends: a date and a clock the parser reads back exactly ("Tue 28 Oct at 3:00 PM"). */
export function offerWords(iso: string, zone: string, hour12: boolean): string {
  return DateTime.fromMillis(ms(iso), { zone })
    .setLocale('en')
    .toFormat(hour12 ? "ccc d LLL 'at' h:mm a" : "ccc d LLL 'at' HH:mm");
}

/** "Tuesday morning", "today and tomorrow", "the next few days": where a set of offers falls. */
function offersPhrase(offers: readonly string[], now: DateTime): string {
  const days = [...new Set(offers.map((each) => dayWord(DateTime.fromMillis(ms(each), { zone: now.zone }), now)))];
  if (days.length > 2) return 'the next few days';
  if (days.length === 2) return `${days[0] ?? ''} and ${days[1] ?? ''}`;
  const parts = [
    ...new Set(
      offers.map((each) => {
        const hour = DateTime.fromMillis(ms(each), { zone: now.zone }).hour;
        return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
      }),
    ),
  ];
  return parts.length === 1 ? `${days[0] ?? ''} ${parts[0] ?? ''}` : (days[0] ?? 'soon');
}

/** A sentence's first letter in capitals. */
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The two suggestions under a reply with times. */
function moreSuggestions(offers: readonly string[], now: DateTime): readonly string[] {
  if (offers.length === 0) return [];
  const furthest = Math.max(...offers.map((each) => ms(each)));
  return [SAY.later, furthest - now.toMillis() <= 2 * 86_400_000 ? SAY.nextWeek : SAY.earliest];
}

/** Where the meeting happens, before there is a booking to say it about. */
function whereSentence(page: ChatPage): string {
  switch (page.location.type) {
    case 'video':
      return 'It’s a video call. The link comes with the confirmation.';
    case 'phone':
      return `It’s a phone call. ${page.hostName} will call the number you give.`;
    case 'address':
      return `In person, at ${page.location.value}.`;
    case 'custom':
      return page.location.value;
  }
}

/** Questions answered without moving the booking on: a held time and its read back wait behind them. */
const QUESTIONS: ReadonlySet<ChatIntent> = new Set([
  'duration',
  'location',
  'change-policy',
  'thanks',
  'length-refused',
]);

/** The words for a state, in the visitor's zone (`now` carries it) and clock. */
export function answer(
  state: ChatState,
  context: {
    readonly now: DateTime;
    readonly hour12: boolean;
    readonly page: ChatPage;
    readonly duration: number;
    readonly needsPhone: boolean;
  },
): ChatAnswer {
  const { now, hour12, page, duration, needsPhone } = context;
  const offers = state.offered;
  const named = state.window?.phrase;
  const say = (text: string, shown: readonly string[] = [], suggestions?: readonly string[]): ChatAnswer => ({
    text,
    offers: shown,
    suggestions: state.readBack ? [SAY.confirm, SAY.somethingElse] : (suggestions ?? moreSuggestions(shown, now)),
  });
  const held = state.held === undefined ? undefined : timeLabel(state.held, now, hour12);
  const lengths = page.durations.map(String);
  const lengthList =
    lengths.length <= 1 ? (lengths[0] ?? '') : `${lengths.slice(0, -1).join(', ')} or ${lengths.at(-1) ?? ''}`;

  const isQuestion = QUESTIONS.has(state.intent);
  if (state.readBack && !isQuestion && state.held !== undefined && held !== undefined) {
    const who = `${state.name ?? ''} (${state.email ?? ''}${state.phone === undefined ? '' : `, ${state.phone}`})`;
    return say(
      `${capital(held)}, ${String(duration)} minutes, for ${who}. Shall I book it?`,
      [],
      [SAY.confirm, SAY.somethingElse],
    );
  }
  // A time is chosen; the details are still owed.
  if (!isQuestion && state.held !== undefined && state.chosen && held !== undefined) {
    const lead =
      state.intent === 'details'
        ? `Thanks${state.name === undefined ? '' : `, ${state.name}`}.`
        : `Great, ${held} it is.`;
    if (state.name === undefined && state.email === undefined)
      return say(`${lead} What’s your name and email?`, [], []);
    if (state.name === undefined) return say(`${lead} And your name?`, [], []);
    if (state.email === undefined) return say(`${lead} Where should I send the confirmation?`, [], []);
    if (needsPhone && state.phone === undefined) return say(`${lead} And a number to call you on?`, [], []);
  }

  const soon = offersPhrase(offers, now);
  const asideHeld = held === undefined ? '' : ` ${capital(held)} is still yours.`;
  switch (state.intent) {
    case 'offer':
      return say(`${capital(named ?? soon)} works. Take your pick.`, offers);
    case 'single-offer':
      return say(`There’s one opening ${named ?? soon}: ${held ?? ''}. Shall I hold it?`, offers);
    case 'exact':
    case 'select':
    case 'confirm':
      return say(`Great, ${held ?? 'that'} it is. What’s your name and email?`, [], []);
    case 'point-miss':
      return say(`That time isn’t open. Closest I have is ${soon}.`, offers);
    case 'none-in-window':
      return say(`Nothing ${named ?? 'then'}, I’m afraid. Closest I have is ${soon}.`, offers);
    case 'reject-offer':
      return say(`No problem. How about ${soon}?`, offers);
    case 'availability':
      return say(`Here’s what’s open next.`, offers);
    case 'select-ambiguous':
      return say(`Which one? Tap a time, or say “the first one”.`, offers);
    case 'confirm-nothing':
      return say(`Happy to. When suits? “Tomorrow afternoon” is enough to go on.`, soonest(offers));
    case 'exhausted':
      return say(`${page.hostName} has nothing open in the time this page books ahead, sorry.`, [], []);
    case 'duration':
      return say(`It’s ${String(duration)} minutes.${asideHeld}`, held === undefined ? offers : []);
    case 'location':
      return say(`${whereSentence(page)}${asideHeld}`, held === undefined ? offers : []);
    case 'change-policy':
      return say(
        `Yes. Every confirmation carries a link to move or cancel it yourself, any time.${asideHeld}`,
        held === undefined ? offers : [],
      );
    case 'length':
      return say(`${String(duration)} minutes it is. Here’s what’s open.`, offers);
    case 'length-refused':
      return say(`This page offers ${lengthList} minutes.`, offers);
    case 'thanks':
      return say(`You’re welcome.`, [], []);
    case 'details':
      return say(
        `Thanks${state.name === undefined ? '' : `, ${state.name}`}. When suits? Here’s what’s open next.`,
        offers,
      );
    case 'not-understood':
      return say(
        `Sorry, I didn’t catch a time in that. Try something like “Thursday morning”, or tap one of these.`,
        offers,
      );
    case 'greet':
    case 'await-details':
    case 'await-confirm':
    case 'book':
      return say(greeting(page, duration), offers);
  }
}

/** The chat's opening line (AC-1502). */
export function greeting(page: ChatPage, duration: number): string {
  return `Hi! I book ${page.hostName}’s ${page.title} (${String(duration)} min). Tell me roughly when suits, “tomorrow afternoon” is enough, or tap a time.`;
}
