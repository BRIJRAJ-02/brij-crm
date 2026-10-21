// One turn of the booking chat (spec 0042): the page's facts and its open
// times through the same services the picker reads (`getPublicBookingPage`,
// `readPublicSlots`), the visitor's lines replayed (`agent.ts`), and, when the
// replay ends on a yes to the read back, the booking through the same service
// the form books through (`bookPublicSlot`), so there is one booking path and
// one integrity check (AC-1515). Nothing here reads a CRM record or recognises
// the visitor (AC-1518), and a reply names only open times, the page's facts
// and what the visitor typed (AC-1519).
import { createHash } from 'node:crypto';
import type { BookingDuration, PublicBooking, PublicChatInput, PublicChatReply } from '@crm/contracts';
import { DateTime } from 'luxon';
import type { BookingEntry } from '../../access/door.ts';
import { isRefusal } from '../../engine/refusals.ts';
import type { AfterWrite } from '../../engine/write.ts';
import {
  bookPublicSlot,
  findPublicBooking,
  getPublicBookingPage,
  readPublicSlots,
  type PublicBookingDeps,
} from '../public.ts';
import { answer, fullTimeLabel, OFFER_COUNT, replay, settledLength, type ChatPage } from './agent.ts';
import { isYes } from './parse.ts';

/** The furthest one turn looks ahead, in days: the slots read's own cap. */
export const CHAT_HORIZON_DAYS = 62;

/** A turn's outcome: the reply, and whether it made a new booking (so the caller wakes the relay). */
export interface ChatTurn {
  readonly reply: PublicChatReply;
  readonly bookedNew: boolean;
}

/**
 * The booking's idempotency key for a chat: the conversation hashed into a
 * UUID (version 8). A conversation books once; a retried turn answers the
 * booking it already made (AC-1515), and a time lost to a race leaves no row,
 * so the next yes books afresh.
 */
export function chatIdempotencyKey(conversationId: string): string {
  const hex = createHash('sha256').update(`chat|${conversationId}`).digest('hex');
  const variant = ((Number.parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** One chat turn on the entry's page. Refusals other than a taken time are thrown, as the form's are. */
export async function chatTurn(
  entry: BookingEntry,
  deps: PublicBookingDeps,
  input: PublicChatInput,
  hooks: readonly AfterWrite[] = [],
  /** `mayBook` is asked once, just before a booking: false (a spent limit, the bot checks) skips it. */
  options: { readonly mayBook?: () => boolean } = {},
): Promise<ChatTurn> {
  const page = await getPublicBookingPage(entry);
  const nowDate = deps.now?.() ?? new Date();
  const now = DateTime.fromJSDate(nowDate).setZone(input.timeZone);
  const lines = input.messages.filter((line) => line.role === 'visitor').map((line) => line.text);
  const fallback = page.durations.find((each) => each === input.duration) ?? page.durations[0] ?? 30;
  const settled = settledLength(lines, page.durations, fallback);
  const duration: BookingDuration = page.durations.find((each) => each === settled) ?? fallback;
  const horizonDays = Math.min(page.windowDays, CHAT_HORIZON_DAYS);
  const chatPage: ChatPage = {
    title: page.title,
    hostName: page.hostName,
    durations: page.durations,
    location: page.location,
  };
  const needsPhone = page.location.type === 'phone';
  const quiet = (text: string): ChatTurn => ({
    reply: { text, offers: [], suggestions: [], duration },
    bookedNew: false,
  });

  const key = chatIdempotencyKey(input.conversationId);
  const done = (
    booking: { readonly booking: PublicBooking; readonly manageToken: string },
    /** The address just typed; left out for a retry, whose booking may have gone to an earlier one. */
    email: string | undefined,
    isNew: boolean,
  ): ChatTurn => ({
    reply: {
      text: `Done. You’re booked for ${fullTimeLabel(booking.booking.start, now, input.hour12)}. ${
        email === undefined ? 'The details are in your email.' : `The details are on their way to ${email}.`
      }`,
      offers: [],
      suggestions: [],
      duration,
      booked: { booking: booking.booking, manageToken: booking.manageToken },
    },
    bookedNew: isNew,
  });
  // A retried yes: the time it booked is no longer open, so answer the booking it made.
  const last = lines.at(-1) ?? '';
  if (isYes(last)) {
    const made = await findPublicBooking(entry, deps, key);
    if (made !== undefined) return done(made, undefined, false);
  }

  const read = await readPublicSlots(entry, deps, {
    from: nowDate.toISOString(),
    to: new Date(nowDate.getTime() + horizonDays * 86_400_000).toISOString(),
    duration,
    tz: input.timeZone,
  });
  // Fail closed, as the picker does: no calendar, no times.
  if (read.calendar === 'unreachable') {
    return quiet(
      `${page.hostName}’s calendar can’t be read right now, so I can’t offer times. Try again a little later.`,
    );
  }
  const slots = read.slots.map((slot) => slot.start);
  const context = { slots, now, horizonDays, needsPhone, durations: page.durations };
  const state = replay(lines, context);
  const words = { now, hour12: input.hour12, page: chatPage, duration, needsPhone };

  if (state.intent !== 'book' || state.held === undefined || state.name === undefined || state.email === undefined) {
    const said = answer(state, words);
    return {
      reply: { text: said.text, offers: [...said.offers], suggestions: [...said.suggestions], duration },
      bookedNew: false,
    };
  }

  const start = state.held;
  if (options.mayBook?.() === false) return quiet('I couldn’t book that just now. Say yes again in a moment.');
  try {
    const booked = await bookPublicSlot(
      entry,
      deps,
      {
        idempotencyKey: key,
        start,
        duration,
        name: state.name,
        email: state.email,
        timeZone: input.timeZone,
        ...(state.phone === undefined ? {} : { phone: state.phone }),
      },
      hooks,
      undefined,
      // Only the visitor's own lines: an assistant line came from the client, and nothing vouches for it.
      { chat: input.messages.filter((line) => line.role === 'visitor') },
    );
    return done(booked, state.email, !booked.replayed);
  } catch (error) {
    if (!isRefusal(error) || error.refusal.code !== 'SLOT_TAKEN') throw error;
    const at = Date.parse(start);
    const others = slots
      .filter((each) => each !== start)
      .sort((a, b) => Math.abs(Date.parse(a) - at) - Math.abs(Date.parse(b) - at))
      .slice(0, OFFER_COUNT)
      .sort();
    return {
      reply: {
        text:
          others.length === 0
            ? 'Someone just took that time, and nothing else is open. Sorry.'
            : 'Someone just took that time. Here’s what’s closest now.',
        offers: others,
        suggestions: [],
        duration,
      },
      bookedNew: false,
    };
  }
}
