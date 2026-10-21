// Brief
// Purpose: book by chat on /b/<publicKey> (spec 0041): the visitor says roughly when suits and books by typing.
// Main task: a few turns ("next Tuesday afternoon", "the second one", a name and email, "yes") end on the guest page.
// Leaves out: voice, the visitor's own calendar, guests and notes (the form has them); nothing else on the page changes.
//
// Its own chunk, loaded when Chat is first chosen. The conversation lives here; every turn sends the whole thread
// (the server replays the visitor's lines against the open times) and draws the reply's times as buttons.
import { isDataError, type BookingClient, type PublicBookingPage, type PublicChatLine } from '@crm/data/booking';
import { BookingChat, type BookingChatDay, type BookingChatLine } from '@crm/ui/public-booking/chat';
import { useState } from 'react';
import { strings } from './strings.ts';
import { dayKey, dayLabels, offerWords, timeLabel } from './time.ts';

/** The most lines one turn sends (the API's cap): older ones drop off the front. */
const MAX_LINES = 40;
/** The longest message. */
const MAX_TEXT = 500;
/** How many times the greeting offers. */
const GREETING_TIMES = 6;

/** Props for the chat panel. */
export interface ChatPanelProps {
  readonly client: BookingClient;
  readonly page: PublicBookingPage;
  readonly locale: string;
  readonly zone: string;
  readonly hour12: boolean;
  readonly duration: number;
  /** The open starts the page already holds, chronological: the greeting offers the first few. */
  readonly starts: readonly string[];
  /** The chat settled on another length: the rail follows. */
  readonly onDuration: (minutes: number) => void;
  readonly onBooked: (manageToken: string) => void;
}

type Line = BookingChatLine & { readonly sent: string };

/** Offered starts grouped under their day, in the visitor's language and zone. */
function daysOf(starts: readonly string[], zone: string, locale: string, hour12: boolean, minutes: number) {
  const days = new Map<string, BookingChatDay['times'][number][]>();
  for (const start of starts) {
    const key = dayKey(Date.parse(start), zone);
    const day = dayLabels(key, locale).short;
    const label = timeLabel(start, zone, locale, hour12);
    days.set(day, [...(days.get(day) ?? []), { id: start, label, name: strings.timeName(label, day, minutes) }]);
  }
  return [...days].map(([day, times]): BookingChatDay => ({ day, times }));
}

/** The chat: the greeting from the times the page holds, then a turn per message. */
export function ChatPanel({
  client,
  page,
  locale,
  zone,
  hour12,
  duration,
  starts,
  onDuration,
  onBooked,
}: ChatPanelProps) {
  const [conversationId] = useState(() => crypto.randomUUID());
  const [lines, setLines] = useState<readonly Line[]>(() => {
    const offered = starts.slice(0, GREETING_TIMES);
    const text =
      offered.length === 0
        ? strings.chatNoTimes(page.hostName)
        : strings.chatGreeting(page.hostName, page.title, duration);
    return [
      {
        id: 'greeting',
        role: 'assistant',
        text,
        sent: text,
        days: daysOf(offered, zone, locale, hour12, duration),
        suggestions: offered.length === 0 ? [] : strings.chatSuggestions,
      },
    ];
  });
  const [isWaiting, setWaiting] = useState(false);
  const [error, setError] = useState<{ readonly message: string; readonly retry?: readonly Line[] } | undefined>();
  const [isDone, setDone] = useState(false);

  const turn = (thread: readonly Line[]) => {
    setWaiting(true);
    setError(undefined);
    const messages: PublicChatLine[] = thread.slice(-MAX_LINES).map((line) => ({ role: line.role, text: line.sent }));
    client
      .chat(page.publicKey, {
        conversationId,
        duration: duration as 15 | 30 | 45 | 60 | 90,
        timeZone: zone,
        hour12,
        messages,
      })
      .then(
        (reply) => {
          setWaiting(false);
          const said: Line = {
            id: `a${String(thread.length)}`,
            role: 'assistant',
            text: reply.text,
            sent: reply.text,
            days: daysOf(reply.offers, zone, locale, hour12, reply.duration),
            suggestions: reply.suggestions,
          };
          setLines([...thread, said]);
          if (reply.duration !== duration) onDuration(reply.duration);
          if (reply.booked !== undefined) {
            setDone(true);
            onBooked(reply.booked.manageToken);
          }
        },
        (failure: unknown) => {
          setWaiting(false);
          const code = isDataError(failure) ? failure.code : undefined;
          setError(
            code === 'RATE_LIMITED'
              ? { message: strings.chatTooMany, retry: thread }
              : code === 'INPUT_INVALID' || code === 'PAYLOAD_TOO_LARGE'
                ? { message: strings.chatTooLong }
                : code === 'BOOKING_CLOSED' || code === 'NOT_FOUND'
                  ? { message: strings.errors.closed }
                  : code === 'API_UNAVAILABLE'
                    ? { message: strings.errors.offline, retry: thread }
                    : { message: strings.errors.failed, retry: thread },
          );
        },
      );
  };

  const send = (text: string) => {
    const thread: readonly Line[] = [
      ...lines,
      { id: `v${String(lines.length)}`, role: 'visitor', text, sent: text.slice(0, MAX_TEXT) },
    ];
    setLines(thread);
    turn(thread);
  };

  const retry = error?.retry;
  return (
    <BookingChat
      lines={lines}
      isWaiting={isWaiting}
      isDone={isDone}
      maxLength={MAX_TEXT}
      {...(error === undefined ? {} : { error: error.message })}
      {...(retry === undefined ? {} : { onRetry: () => turn(retry) })}
      onSend={send}
      onPickTime={(start) => send(offerWords(start, zone, hour12))}
    />
  );
}
