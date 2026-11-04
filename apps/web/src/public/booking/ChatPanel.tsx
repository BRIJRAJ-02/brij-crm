// Brief
// Purpose: book by chat on /b/<publicKey> (spec 0042): the visitor says roughly when suits and books by typing.
// Main task: a few turns ("next Tuesday afternoon", "the second one", a name and email, "yes") end on the guest page.
// Leaves out: voice and the visitor's own calendar. Since 4 Nov 2026 it does what the details step does (chat parity):
// the page's lengths as chips, the zone, the page's questions (required ones in turn, optional ones on a tap), guests
// and a note, each asked in the host's voice, then the read back and the yes.
//
// Its own chunk, loaded when Chat is first chosen. Every turn sends the visitor's own lines (the server replays them
// against the open times, and keeps them on the booking it makes) and draws the reply's times as buttons. The
// conversation is kept by the page (`memory`), so a length or zone change, or a look at Month and back, keeps it.
import { isDataError, type BookingClient, type PublicBookingPage, type PublicChatLine } from '@crm/data/booking';
import {
  BookingChat,
  chatAnswerOf,
  chatChipsOf,
  chatQuestions,
  type BookingChatDay,
  type BookingChatError,
  type BookingChatLine,
} from '@crm/ui/public-booking/chat';
import { useState } from 'react';
import { strings } from './strings.ts';
import { dayKey, dayLabels, longDate, offerWords, rangeLabel, timeLabel, zoneName } from './time.ts';
import type { TicketKeeper } from './ticket.ts';

/** The most visitor lines one chat sends (the API's cap). */
const MAX_LINES = 40;
/** The longest message. */
const MAX_TEXT = 500;
/** How many times the greeting offers. */
const GREETING_TIMES = 6;

/**
 * A line as the panel keeps it: as shown, as sent (a time button's words), and the visitor's name the chat had heard.
 * A `local` line is the page's own (a question it asks, the answer given): never sent, so the server's replay of the
 * visitor's words never reads an answer as a time.
 */
type Line = BookingChatLine & { readonly sent: string; readonly heard?: string; readonly local?: true };

/** The most guests a chat booking takes, as the details step's. */
const MAX_GUESTS = 10;

/** What the page itself is asking: one of its questions, the "anything else" row, a guest, a note. */
type Ask =
  | { readonly kind: 'question'; readonly key: string }
  | { readonly kind: 'menu' }
  | { readonly kind: 'guest' }
  | { readonly kind: 'note' };

/** What the chat collected beside the conversation, and where its own questions stand. */
interface Extras {
  readonly answers: Readonly<Record<string, unknown>>;
  readonly guests: readonly string[];
  readonly note: string;
  /** The menu's chips already used ("Add a guest", a question's key): the row comes back without them. */
  readonly used: readonly string[];
  readonly ask?: Ask;
  /** The read back the server sent, held while the page asks its own questions; shown on "That's all". */
  readonly held?: Line;
  /** "That's all" was said: a later read back shows at once. */
  readonly isSettled: boolean;
}

const NO_EXTRAS: Extras = { answers: {}, guests: [], note: '', used: [], isSettled: false };

/** Who the chat speaks as (BookingChat's host): the rail's face, and the host's first name or the team's name. */
function hostOf(page: PublicBookingPage) {
  const isTeam = page.team !== undefined;
  return {
    name: page.hostName,
    ...(isTeam || page.hostImage === undefined ? {} : { image: page.hostImage }),
    label: isTeam ? page.hostName : (page.hostName.trim().split(/\s+/u)[0] ?? page.hostName),
    isTeam,
  };
}

/** The conversation, held by the page across the panel's mounts. */
export interface ChatMemory {
  readonly conversationId: string;
  readonly lines: readonly Line[];
  readonly extras?: Extras;
  /** The zone the conversation's times were last given in: a change after it is said in one line. */
  readonly zone?: string;
}

/** Props for the chat panel. */
export interface ChatPanelProps {
  readonly client: BookingClient;
  readonly page: PublicBookingPage;
  readonly locale: string;
  readonly zone: string;
  readonly hour12: boolean;
  readonly duration: number;
  /** The open starts the page holds, chronological: the greeting offers the first few. */
  readonly starts: readonly string[];
  /** The conversation so far, kept by the page between mounts; undefined before the first message. */
  readonly memory: ChatMemory | undefined;
  /** Keeps the conversation as it changes. */
  readonly onMemory: (memory: ChatMemory) => void;
  /** When the page loaded, for the bot checks a booking passes. */
  readonly startedAt: number;
  /** The page's fill ticket (B-04): the turn that books carries it, as the details form's booking does. */
  readonly tickets: TicketKeeper;
  /** The chat settled on another length: the rail follows. */
  readonly onDuration: (minutes: number) => void;
  readonly onBooked: (manageToken: string) => void;
  /** Opens the rail's time zone picker, from the greeting's zone chip. */
  readonly onZone: () => void;
  /** The visitor's country, guessed: a phone answer's code and a country answer's start. */
  readonly countryGuess?: string;
  /** A form's signed hand off (spec 0043): sent with each turn, so routing and the form's answers carry over. */
  readonly handoff?: string;
}

/** Offered starts grouped under their day, in the visitor's language and zone. */
function daysOf(starts: readonly string[], zone: string, locale: string, hour12: boolean, minutes: number) {
  const days = new Map<string, BookingChatDay['times'][number][]>();
  for (const start of starts) {
    const day = dayLabels(dayKey(Date.parse(start), zone), locale).short;
    const label = timeLabel(start, zone, locale, hour12);
    days.set(day, [...(days.get(day) ?? []), { id: start, label, name: strings.timeName(label, day, minutes) }]);
  }
  return [...days].map(([day, times]): BookingChatDay => ({ day, times }));
}

/**
 * What the prompt box asks after a reply (the owner, 4 Nov 2026): the read back's yes, the detail the chat waits on,
 * the time when the reply offers one day's, the day when it offers several. Anything else keeps the first question.
 */
function promptOf(reply: {
  readonly confirm?: string;
  readonly asks?: 'details' | 'name' | 'email' | 'phone';
  readonly days: readonly BookingChatDay[];
}): Pick<BookingChatLine, 'prompt' | 'answer'> {
  if (reply.confirm !== undefined) return { prompt: strings.chatPrompts.confirm };
  if (reply.asks !== undefined)
    return {
      prompt: strings.chatPrompts[reply.asks],
      // The phone's keyboard and autofill follow the question: an email, a number, a name.
      ...(reply.asks === 'email' ? { answer: 'email' as const } : {}),
      ...(reply.asks === 'phone' ? { answer: 'tel' as const } : {}),
      ...(reply.asks === 'name' || reply.asks === 'details' ? { answer: 'name' as const } : {}),
    };
  if (reply.days.length === 1) return { prompt: strings.chatPrompts.time };
  if (reply.days.length > 1) return { prompt: strings.chatPrompts.when };
  return {};
}

/** A new conversation: a fresh id and the greeting, drawn from the times the page holds. */
function fresh(props: ChatPanelProps): ChatMemory {
  return { conversationId: crypto.randomUUID(), lines: [greetingOf(props)], extras: NO_EXTRAS, zone: props.zone };
}

/**
 * The opening line, drawn from the times the page holds: with the page's lengths as chips when it offers several, and
 * the zone the times are in as a chip that opens the rail's picker.
 */
function greetingOf(props: ChatPanelProps): Line {
  const { page, starts, zone, locale, hour12, duration } = props;
  const offered = starts.slice(0, GREETING_TIMES);
  const host = hostOf(page);
  const text =
    offered.length === 0 ? strings.chatNoTimes(host.isTeam) : strings.chatGreeting(host, page.title, duration);
  return {
    id: 'greeting',
    role: 'assistant',
    text,
    sent: text,
    days: daysOf(offered, zone, locale, hour12, duration),
    suggestions: [strings.chatZoneChip(zoneName(zone)), ...(offered.length === 0 ? [] : strings.chatSuggestions)],
    ...(page.durations.length > 1
      ? {
          choice: {
            label: strings.length,
            options: page.durations.slice(0, 4).map((minutes) => ({
              id: String(minutes),
              label: strings.minutesShort(minutes),
            })),
            selected: String(duration),
          },
        }
      : {}),
    // The opening question, whatever day its times fall on.
    prompt: strings.chatPrompts.when,
  };
}

/** A line the page says itself, in the host's voice: never sent to the server. */
function hostLine(id: string, text: string, more: Partial<BookingChatLine> = {}): Line {
  return { id, role: 'assistant', text, sent: text, local: true, ...more };
}

/** The chat: the greeting from the times the page holds, then a turn per message. */
export function ChatPanel(props: ChatPanelProps) {
  const {
    client,
    page,
    locale,
    zone,
    hour12,
    duration,
    startedAt,
    tickets,
    memory,
    onMemory,
    onDuration,
    onBooked,
    onZone,
    countryGuess,
    handoff,
  } = props;
  const [chat, setChat] = useState<ChatMemory>(() => memory ?? fresh(props));
  const [isWaiting, setWaiting] = useState(false);
  const [error, setError] = useState<BookingChatError | undefined>();
  const [ended, setEnded] = useState<'booked' | 'closed' | undefined>();
  const keep = (next: ChatMemory) => {
    const stamped = { ...next, zone };
    setChat(stamped);
    onMemory(stamped);
  };
  const { conversationId, lines } = chat;
  const extras = chat.extras ?? NO_EXTRAS;
  const host = hostOf(page);
  const questions = page.questions ?? [];
  // The visitor's name as the chat last heard it: their initials beside their lines from then on.
  const visitorName = lines.findLast((line) => line.heard !== undefined)?.heard;
  const hasSaid = lines.some((line) => line.role === 'visitor');

  // Before the visitor says anything, the greeting follows the page as it is drawn: its length, zone, clock and times.
  // After, a change of zone is said in one line, as a person would mention it; the next message keeps it.
  const zoneNote =
    hasSaid && chat.zone !== undefined && chat.zone !== zone
      ? hostLine(`z${String(lines.length)}`, strings.chatZoneMoved(zoneName(zone)))
      : undefined;
  const shown: readonly Line[] = !hasSaid ? [greetingOf(props)] : zoneNote === undefined ? lines : [...lines, zoneNote];

  /** The page's next question line, or the "anything else" row, once the server read the booking back. */
  const nextAsk = (state: Extras, thread: readonly Line[], lead?: string): { lines: Line[]; extras: Extras } => {
    const shown = chatQuestions(questions, state.answers);
    const owed = shown.find((question) => question.required && state.answers[question.key] === undefined);
    const id = `p${String(thread.length)}`;
    if (owed !== undefined) {
      const chips = chatChipsOf(owed, strings.chatAnswers);
      const isFirst = !shown.some((question) => question.required && state.answers[question.key] !== undefined);
      const text = `${lead === undefined ? '' : `${lead} `}${strings.chatQuestion(owed.label, isFirst && lead === undefined)}`;
      return {
        lines: [
          hostLine(id, text, {
            ...(chips === undefined
              ? { prompt: owed.placeholder ?? owed.label }
              : { suggestions: chips, prompt: strings.chatMenu.prompt }),
            ...(owed.answerType === 'email' ? { answer: 'email' as const } : {}),
            ...(owed.answerType === 'phone' ? { answer: 'tel' as const } : {}),
          }),
        ],
        extras: { ...state, ask: { kind: 'question', key: owed.key } },
      };
    }
    // Optional things in one row, each a tap: a guest, a note, the page's own optional questions, then done.
    const optional = shown.filter(
      (question) =>
        !question.required && state.answers[question.key] === undefined && !state.used.includes(question.key),
    );
    const chips = [
      ...(state.used.includes('guest') || state.guests.length >= MAX_GUESTS ? [] : [strings.chatMenu.guest]),
      ...(state.used.includes('note') ? [] : [strings.chatMenu.note]),
      ...optional.map((question) => question.label),
      strings.chatMenu.done,
    ];
    return {
      lines: [
        hostLine(id, `${lead === undefined ? '' : `${lead} `}${strings.chatMenu.ask(host.isTeam)}`, {
          suggestions: chips,
          prompt: strings.chatMenu.prompt,
        }),
      ],
      extras: { ...state, ask: { kind: 'menu' } },
    };
  };

  /** The held read back, with the guests and answers the chat collected on its card. */
  const settle = (state: Extras, thread: readonly Line[]) => {
    const held = state.held;
    const readBack: Line[] =
      held === undefined
        ? []
        : [
            {
              ...held,
              id: `r${String(thread.length)}`,
              ...(held.card === undefined || state.guests.length === 0
                ? {}
                : { card: { ...held.card, who: `${held.card.who} · ${strings.chatGuestCount(state.guests.length)}` } }),
            },
          ];
    const { held: _held, ask: _ask, ...rest } = state;
    keep({ conversationId, lines: [...thread, ...readBack], extras: { ...rest, isSettled: true } });
  };

  /** A reply to the page's own question, the "anything else" row, a guest or a note. */
  const answerLocally = (ask: Ask, text: string) => {
    const said: Line = { id: `v${String(shown.length)}`, role: 'visitor', text, sent: text, local: true };
    const thread = [...shown, said];
    if (ask.kind === 'menu') {
      if (text === strings.chatMenu.done) {
        settle(extras, thread);
        return;
      }
      if (text === strings.chatMenu.guest) {
        keep({
          conversationId,
          lines: [
            ...thread,
            hostLine(`g${String(thread.length)}`, strings.chatGuestAsk, {
              prompt: strings.chatGuestPrompt,
              answer: 'email',
            }),
          ],
          extras: { ...extras, ask: { kind: 'guest' } },
        });
        return;
      }
      if (text === strings.chatMenu.note) {
        keep({
          conversationId,
          lines: [
            ...thread,
            hostLine(`n${String(thread.length)}`, strings.chatNoteAsk(host.isTeam), { prompt: strings.chatNotePrompt }),
          ],
          extras: { ...extras, ask: { kind: 'note' } },
        });
        return;
      }
      const question = questions.find((each) => each.label === text);
      if (question !== undefined) {
        const chips = chatChipsOf(question, strings.chatAnswers);
        keep({
          conversationId,
          lines: [
            ...thread,
            hostLine(`q${String(thread.length)}`, strings.chatQuestion(question.label, false), {
              ...(chips === undefined
                ? { prompt: question.placeholder ?? question.label }
                : { suggestions: chips, prompt: strings.chatMenu.prompt }),
            }),
          ],
          extras: { ...extras, used: [...extras.used, question.key], ask: { kind: 'question', key: question.key } },
        });
      }
      return;
    }
    if (ask.kind === 'guest') {
      const emails = text.split(/[\s,;]+/u).filter((each) => each !== '');
      const isEmail = (each: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(each);
      if (emails.length === 0 || !emails.every(isEmail)) {
        keep({
          conversationId,
          lines: [
            ...thread,
            hostLine(`g${String(thread.length)}`, strings.chatGuestWrong, {
              prompt: strings.chatGuestPrompt,
              answer: 'email',
            }),
          ],
          extras,
        });
        return;
      }
      const guests = [...new Set([...extras.guests, ...emails.map((each) => each.toLowerCase())])].slice(0, MAX_GUESTS);
      const next = nextAsk(
        { ...extras, guests, used: [...extras.used, 'guest'] },
        thread,
        strings.chatGuestAdded(emails.length),
      );
      keep({ conversationId, lines: [...thread, ...next.lines], extras: next.extras });
      return;
    }
    if (ask.kind === 'note') {
      const next = nextAsk(
        { ...extras, note: text.slice(0, 2000), used: [...extras.used, 'note'] },
        thread,
        strings.chatNoted,
      );
      keep({ conversationId, lines: [...thread, ...next.lines], extras: next.extras });
      return;
    }
    const question = questions.find((each) => each.key === ask.key);
    if (question === undefined) return;
    const answered = chatAnswerOf(question, text, strings.chatAnswers, countryGuess);
    if ('problem' in answered) {
      const chips = chatChipsOf(question, strings.chatAnswers);
      keep({
        conversationId,
        lines: [
          ...thread,
          hostLine(`q${String(thread.length)}`, strings.chatAnswerWrong(answered.problem), {
            ...(chips === undefined
              ? { prompt: question.placeholder ?? question.label }
              : { suggestions: chips, prompt: strings.chatMenu.prompt }),
          }),
        ],
        extras,
      });
      return;
    }
    const next = nextAsk({ ...extras, answers: { ...extras.answers, [question.key]: answered.value } }, thread);
    keep({ conversationId, lines: [...thread, ...next.lines], extras: next.extras });
  };

  const turn = (thread: readonly Line[], state: Extras = extras) => {
    const said: PublicChatLine[] = thread
      .filter((line) => line.role === 'visitor' && line.local !== true)
      .map((line) => ({ role: 'visitor', text: line.sent }));
    if (said.length > MAX_LINES) {
      setError({ message: strings.chatTooLong, onRestart: restart });
      return;
    }
    setWaiting(true);
    setError(undefined);
    tickets
      .peek()
      .then((filled) =>
        client.chat(page.publicKey, {
          conversationId,
          duration,
          timeZone: zone,
          hour12,
          messages: said,
          startedAt,
          ...(state.guests.length === 0 ? {} : { guests: [...state.guests] }),
          ...(state.note === '' ? {} : { note: state.note }),
          ...(Object.keys(state.answers).length === 0 ? {} : { answers: { ...state.answers } }),
          ...(handoff === undefined ? {} : { p: handoff }),
          ...(filled === undefined ? {} : { ticket: filled }),
        }),
      )
      .then(
        (reply) => {
          setWaiting(false);
          const days = daysOf(reply.offers, zone, locale, hour12, reply.duration);
          const asked = promptOf({
            days,
            ...(reply.confirm === undefined ? {} : { confirm: reply.confirm }),
            ...(reply.asks === undefined ? {} : { asks: reply.asks }),
          });
          const answer: Line = {
            id: `a${String(thread.length)}`,
            role: 'assistant',
            text: reply.text,
            sent: reply.text,
            days,
            suggestions: reply.suggestions,
            ...asked,
            ...(reply.name === undefined ? {} : { heard: reply.name }),
            ...(reply.confirm === undefined ? {} : { confirm: reply.confirm }),
            ...(reply.readBack === undefined
              ? {}
              : (() => {
                  // The confirm card's head: the booking as the confirmation will show it.
                  const { start, name, email } = reply.readBack;
                  const end = new Date(Date.parse(start) + reply.duration * 60_000).toISOString();
                  const tile = new Intl.DateTimeFormat(locale, {
                    timeZone: zone,
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  })
                    .formatToParts(new Date(start))
                    .reduce<Record<string, string>>((all, part) => ({ ...all, [part.type]: part.value }), {});
                  return {
                    card: {
                      weekday: tile.weekday ?? '',
                      day: tile.day ?? '',
                      month: tile.month ?? '',
                      title: strings.chatCardTitle(page.title, page.hostName),
                      when: `${longDate(start, zone, locale)} · ${rangeLabel(start, end, zone, locale, hour12)}`,
                      who: `${name} · ${email}`,
                    },
                  };
                })()),
          };
          // The read back waits while the page asks its own questions and offers the optional ones (chat parity):
          // the host asks, then reads the whole booking back once the visitor says that's all.
          if (reply.confirm !== undefined && !state.isSettled) {
            const named: Line = { ...answer, text: reply.text };
            const next = nextAsk({ ...state, held: named }, thread);
            keep({
              conversationId,
              lines: [
                ...thread,
                ...next.lines.map((line, index) =>
                  index === 0 && reply.name !== undefined ? { ...line, heard: reply.name } : line,
                ),
              ],
              extras: next.extras,
            });
          } else keep({ conversationId, lines: [...thread, answer], extras: state });
          if (reply.duration !== duration) onDuration(reply.duration);
          if (reply.booked !== undefined) {
            setEnded('booked');
            onBooked(reply.booked.manageToken);
          }
        },
        (failure: unknown) => {
          setWaiting(false);
          const code = isDataError(failure) ? failure.code : undefined;
          // An answer the server refused (the page's questions changed meanwhile, say): the host asks it again.
          const refused = isDataError(failure)
            ? failure.data?.refusals?.find((each) => each.field?.startsWith('answers.') === true)
            : undefined;
          const key = refused?.field?.slice('answers.'.length);
          const question = key === undefined ? undefined : questions.find((each) => each.key === key);
          if (refused !== undefined && question !== undefined) {
            const { [question.key]: _gone, ...answers } = state.answers;
            const chips = chatChipsOf(question, strings.chatAnswers);
            keep({
              conversationId,
              lines: [
                ...thread,
                hostLine(`q${String(thread.length)}`, strings.chatAnswerWrong(refused.message), {
                  ...(chips === undefined
                    ? { prompt: question.placeholder ?? question.label }
                    : { suggestions: chips }),
                }),
              ],
              extras: { ...state, answers, isSettled: false, ask: { kind: 'question', key: question.key } },
            });
            return;
          }
          const again = () => turn(thread, state);
          if (code === 'RATE_LIMITED') setError({ message: strings.chatTooMany, onRetry: again, isPause: true });
          else if (code === 'INPUT_INVALID' || code === 'PAYLOAD_TOO_LARGE')
            setError({ message: strings.chatTooLong, onRestart: restart });
          else if (code === 'BOOKING_CLOSED' || code === 'NOT_FOUND') {
            setEnded('closed');
            setError({ message: strings.errors.closed });
          } else
            setError({
              message: code === 'API_UNAVAILABLE' ? strings.errors.offline : strings.errors.failed,
              onRetry: again,
            });
        },
      );
  };

  function restart() {
    setError(undefined);
    keep(fresh(props));
  }

  const send = (text: string) => {
    // The greeting's zone chip opens the rail's picker; nothing is said.
    if (text === strings.chatZoneChip(zoneName(zone))) {
      onZone();
      return;
    }
    // A reply to something the page itself asked stays on the page.
    if (extras.ask !== undefined && (extras.ask.kind !== 'menu' || isMenuChip(text))) {
      answerLocally(extras.ask, text);
      return;
    }
    const thread: readonly Line[] = [
      ...shown,
      { id: `v${String(shown.length)}`, role: 'visitor', text, sent: text.slice(0, MAX_TEXT) },
    ];
    // Typed past the "anything else" row: the conversation moves on, and the row comes back with the next read back.
    const { ask: _ask, ...rest } = extras;
    const state: Extras = extras.ask === undefined ? extras : rest;
    keep({ conversationId, lines: thread, extras: state });
    turn(thread, state);
  };

  /** Whether `text` is one of the "anything else" row's own chips. */
  function isMenuChip(text: string) {
    return (
      text === strings.chatMenu.guest ||
      text === strings.chatMenu.note ||
      text === strings.chatMenu.done ||
      questions.some((question) => question.label === text)
    );
  }

  return (
    <BookingChat
      lines={shown}
      host={host}
      {...(visitorName === undefined ? {} : { visitorName })}
      isWaiting={isWaiting}
      isDone={ended !== undefined}
      {...(ended === 'booked'
        ? { doneNote: page.requiresConfirmation === true ? strings.chatRequested : strings.chatBooked }
        : {})}
      maxLength={MAX_TEXT}
      {...(error === undefined ? {} : { error })}
      onSend={send}
      onPickTime={(start) => send(offerWords(start, zone, hour12))}
      onChoose={(minutes) => {
        onDuration(Number(minutes));
      }}
    />
  );
}
