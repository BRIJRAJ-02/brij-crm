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
import { answer, OFFER_COUNT, replay, settledLength, timeLabel, voiceOf, type ChatPage } from './agent.ts';
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
  /**
   * `mayBook` is asked once, just before a booking: false (a spent limit, the bot checks) skips it. `link` is a form's
   * verified hand off (spec 0043): a team page then offers only the hosts its routing chose, as the picker does.
   */
  options: {
    readonly mayBook?: (booking: { readonly email: string; readonly guests: number }) => boolean;
    readonly link?: { readonly submissionId: string };
  } = {},
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
    ...(page.team === undefined ? {} : { isTeam: true }),
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
    booking: { readonly booking: PublicBooking; readonly manageToken: string; readonly pending?: true },
    /** The address just typed; left out for a retry, whose booking may have gone to an earlier one. */
    email: string | undefined,
    isNew: boolean,
  ): ChatTurn => ({
    reply: {
      text: doneLine(booking, page.team !== undefined, timeLabel(booking.booking.start, now, input.hour12), email),
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

  const read = await readPublicSlots(
    entry,
    deps,
    {
      from: nowDate.toISOString(),
      to: new Date(nowDate.getTime() + horizonDays * 86_400_000).toISOString(),
      duration,
      tz: input.timeZone,
    },
    options.link,
  );
  // Fail closed, as the picker does: no calendar, no times.
  if (read.calendar === 'unreachable') {
    const we = voiceOf(chatPage);
    return quiet(`${we.i === 'I' ? 'I' : 'We'} can’t see ${we.my} calendar right now. Try again in a bit.`);
  }
  const slots = read.slots.map((slot) => slot.start);
  const context = { slots, now, horizonDays, needsPhone, durations: page.durations };
  const state = replay(lines, context);
  const words = { now, hour12: input.hour12, page: chatPage, duration, needsPhone };

  if (state.intent !== 'book' || state.held === undefined || state.name === undefined || state.email === undefined) {
    const said = answer(state, words);
    return {
      reply: {
        text: said.text,
        offers: [...said.offers],
        suggestions: [...said.suggestions],
        ...(said.confirm === undefined ? {} : { confirm: said.confirm }),
        ...(said.asks === undefined ? {} : { asks: said.asks }),
        // The name the chat has heard, so the page can draw the visitor's initials beside their lines.
        ...(state.name === undefined ? {} : { name: state.name }),
        ...(said.confirm === undefined ||
        state.held === undefined ||
        state.name === undefined ||
        state.email === undefined
          ? {}
          : { readBack: { start: state.held, name: state.name, email: state.email } }),
        duration,
      },
      bookedNew: false,
    };
  }

  const start = state.held;
  if (options.mayBook?.({ email: state.email, guests: input.guests?.length ?? 0 }) === false)
    return quiet('That didn’t go through. Say yes again in a moment.');
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
        // What the chat collected beside the conversation: guests, a note, the page's own questions' answers.
        ...(input.guests === undefined || input.guests.length === 0 ? {} : { guests: [...input.guests] }),
        ...(input.note === undefined || input.note === '' ? {} : { note: input.note }),
        ...(input.answers === undefined ? {} : { answers: { ...input.answers } }),
        ...(input.p === undefined ? {} : { prefill: input.p }),
      },
      hooks,
      // The form's verified hand off (spec 0043), as the picker's booking carries it: the booking joins that
      // submission, and a team page books one of the hosts its routing chose.
      options.link,
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
            ? 'Someone just took that time, and nothing else is free. Sorry.'
            : 'Someone just took that time. These are the closest.',
        offers: others,
        suggestions: [],
        duration,
      },
      bookedNew: false,
    };
  }
}

/**
 * The chat's last line, in the host's voice (owner, 4 Nov 2026): "You're booked. See you tomorrow at 9:00 AM.", naming
 * the host a team or round robin page picked ("You're booked with Asha."), or, on a page that confirms each booking
 * first, that the request is sent.
 */
export function doneLine(
  booking: { readonly booking: Pick<PublicBooking, 'hostName'>; readonly pending?: true },
  isTeam: boolean,
  when: string,
  email: string | undefined,
): string {
  const details = email === undefined ? 'The details are in your email.' : `Details are on their way to ${email}.`;
  if (booking.pending === true)
    return `Request sent for ${when}. ${isTeam ? 'We’ll' : 'I’ll'} confirm shortly. ${details}`;
  // A round robin's one host by their first name; a collective's several as the booking names them.
  const hosts = booking.booking.hostName;
  const named = /,| and /u.test(hosts) ? hosts : (hosts.trim().split(/\s+/u)[0] ?? hosts);
  return `You’re booked${isTeam ? ` with ${named}` : ''}. See you ${when}. ${details}`;
}
