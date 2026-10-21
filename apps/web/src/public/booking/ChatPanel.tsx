// Brief
// Purpose: book by chat on /b/<publicKey> (spec 0042): the visitor says roughly when suits and books by typing.
// Main task: a few turns ("next Tuesday afternoon", "the second one", a name and email, "yes") end on the guest page.
// Leaves out: voice, the visitor's own calendar, guests and notes (the form has them); nothing else on the page changes.
//
// Its own chunk, loaded when Chat is first chosen. Every turn sends the visitor's own lines (the server replays them
// against the open times, and keeps them on the booking it makes) and draws the reply's times as buttons. The
// conversation is kept by the page (`memory`), so a length or zone change, or a look at Month and back, keeps it.
import { isDataError, type BookingClient, type PublicBookingPage, type PublicChatLine } from '@crm/data/booking';
import {
  BookingChat,
  type BookingChatDay,
  type BookingChatError,
  type BookingChatLine,
} from '@crm/ui/public-booking/chat';
import { useState } from 'react';
import { strings } from './strings.ts';
import { dayKey, dayLabels, offerWords, timeLabel } from './time.ts';

/** The most visitor lines one chat sends (the API's cap). */
const MAX_LINES = 40;
/** The longest message. */
const MAX_TEXT = 500;
/** How many times the greeting offers. */
const GREETING_TIMES = 6;

/** A line as the panel keeps it: as shown, and as sent (a time button's words). */
type Line = BookingChatLine & { readonly sent: string };

/** The conversation, held by the page across the panel's mounts. */
export interface ChatMemory {
  readonly conversationId: string;
  readonly lines: readonly Line[];
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
  /** The chat settled on another length: the rail follows. */
  readonly onDuration: (minutes: number) => void;
  readonly onBooked: (manageToken: string) => void;
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

/** A new conversation: a fresh id and the greeting, drawn from the times the page holds. */
function fresh(props: ChatPanelProps): ChatMemory {
  const { page, starts, zone, locale, hour12, duration } = props;
  const offered = starts.slice(0, GREETING_TIMES);
  const text =
    offered.length === 0
      ? strings.chatNoTimes(page.hostName)
      : strings.chatGreeting(page.hostName, page.title, duration);
  return {
    conversationId: crypto.randomUUID(),
    lines: [
      {
        id: 'greeting',
        role: 'assistant',
        text,
        sent: text,
        days: daysOf(offered, zone, locale, hour12, duration),
        suggestions: offered.length === 0 ? [] : strings.chatSuggestions,
      },
    ],
  };
}

/** The chat: the greeting from the times the page holds, then a turn per message. */
export function ChatPanel(props: ChatPanelProps) {
  const { client, page, locale, zone, hour12, duration, startedAt, memory, onMemory, onDuration, onBooked } = props;
  const [chat, setChat] = useState<ChatMemory>(() => memory ?? fresh(props));
  const [isWaiting, setWaiting] = useState(false);
  const [error, setError] = useState<BookingChatError | undefined>();
  const [ended, setEnded] = useState<'booked' | 'closed' | undefined>();
  const keep = (next: ChatMemory) => {
    setChat(next);
    onMemory(next);
  };
  const { conversationId, lines } = chat;

  const turn = (thread: readonly Line[]) => {
    const said: PublicChatLine[] = thread
      .filter((line) => line.role === 'visitor')
      .map((line) => ({ role: 'visitor', text: line.sent }));
    if (said.length > MAX_LINES) {
      setError({ message: strings.chatTooLong, onRestart: restart });
      return;
    }
    setWaiting(true);
    setError(undefined);
    client
      .chat(page.publicKey, {
        conversationId,
        duration,
        timeZone: zone,
        hour12,
        messages: said,
        startedAt,
      })
      .then(
        (reply) => {
          setWaiting(false);
          const answer: Line = {
            id: `a${String(thread.length)}`,
            role: 'assistant',
            text: reply.text,
            sent: reply.text,
            days: daysOf(reply.offers, zone, locale, hour12, reply.duration),
            suggestions: reply.suggestions,
          };
          keep({ conversationId, lines: [...thread, answer] });
          if (reply.duration !== duration) onDuration(reply.duration);
          if (reply.booked !== undefined) {
            setEnded('booked');
            onBooked(reply.booked.manageToken);
          }
        },
        (failure: unknown) => {
          setWaiting(false);
          const code = isDataError(failure) ? failure.code : undefined;
          const again = () => turn(thread);
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
    const thread: readonly Line[] = [
      ...lines,
      { id: `v${String(lines.length)}`, role: 'visitor', text, sent: text.slice(0, MAX_TEXT) },
    ];
    keep({ conversationId, lines: thread });
    turn(thread);
  };

  return (
    <BookingChat
      lines={lines}
      isWaiting={isWaiting}
      isDone={ended !== undefined}
      {...(ended === 'booked' ? { doneNote: strings.chatBooked } : {})}
      maxLength={MAX_TEXT}
      {...(error === undefined ? {} : { error })}
      onSend={send}
      onPickTime={(start) => send(offerWords(start, zone, hour12))}
    />
  );
}
