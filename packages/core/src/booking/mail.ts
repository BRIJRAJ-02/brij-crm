// What a booking's emails say (spec 0025, Emails, AC-636, AC-637): the
// worker's `crm_booking_mail` task reads the booking again as the system and
// gets back each message's words and parts; the api's mail module draws them
// (React Email) and sends them. Nothing here sends or renders.
//
// Who hears what, after the timefix app's emails:
// - confirmed: the visitor (their booking page's link, and an .ics only when
//   no calendar event exists, since the calendar already invited them
//   otherwise); the host (unless they booked it themselves); each guest not
//   yet invited.
// - moved and cancelled: the visitor and their guests; the host when the
//   guest did it.
// - guests: each guest not yet invited, always with the .ics (a guest added
//   later is not on the calendar event's invitation); and each one invited
//   but taken off since, that they are no longer invited, with a cancelled
//   .ics when ours was the file that invited them.
// - reminders: the visitor, 24 hours and 1 hour before, only while the
//   booking is confirmed and that close (a stale reminder sends nothing).
// A guest never gets the visitor's link: it is the visitor's key. The visitor's own .ics carries it as its URL, the
// same as the guest page's own download does.
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@crm/db';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { schedulingManagers } from '../access/scheduling.ts';
import { addedLaterOf, guestsOf } from './change.ts';
import { buildBookingIcs, icsFilename } from './ics.ts';
import { atLine, whenLine, whenParts } from './mail-when.ts';
import { answerWords, storedBookingAnswers } from './questions.ts';
import type { BookingMailKind } from './mail-queue.ts';
import { loadPage } from './slots.ts';
import { pagePath } from './handles.ts';
import { ensureManageToken, managePath, type ManageLinkKey } from './tokens.ts';

export { atLine, whenLine } from './mail-when.ts';

const { bookingHosts, bookings, members, rotationAssignments, workspaces } = schema;

/** The kinds a request still waiting for its host sends (spec 0062, AC-6203). */
const REQUEST_KINDS: ReadonlySet<string> = new Set(['requested', 'cancelled', 'declined', 'pending_expire']);

/** How long a request waits for its host: 24 hours, or until an hour before it starts, whichever is first. */
export const REQUEST_WAIT_MS = 24 * 3_600_000;
/** How close to its start a request may still wait. */
export const REQUEST_LEAD_MS = 3_600_000;

/** One label and value row of an email. */
export interface MailRow {
  readonly label: string;
  readonly value: string;
}

/** One email, as words and parts: the api draws it. */
export interface BookingMail {
  readonly to: string;
  readonly subject: string;
  /** The inbox preview line. */
  readonly preview: string;
  readonly heading: string;
  readonly intro: string;
  readonly rows: readonly MailRow[];
  /** The one button. */
  readonly button?: { readonly label: string; readonly url: string };
  /** A quiet line under the button. */
  readonly footnote?: string;
  /** Why the reader got it, for the shared footer: the visitor, a guest, or the host. */
  readonly why: string;
  /** The calendar file, when the message carries one. */
  readonly ics?: { readonly filename: string; readonly content: string; readonly method: 'REQUEST' | 'CANCEL' };
  /** Who they meet, by name beside their initials: a round robin booking's assigned host (owner decision, 22 Oct). */
  readonly host?: { readonly label: string; readonly name: string };
  /**
   * The time in the reader's zone, which the email draws large with the zone under it (bookings redesign, 10 November
   * 2026), struck through once it no longer stands (cancelled, declined). It is not repeated as a row.
   */
  readonly when?: { readonly line: string; readonly zone: string; readonly struck?: boolean };
  /** Someone's own words, set apart: why the visitor's booking was cancelled or declined. */
  readonly quote?: string;
  /**
   * The visitor's calendar file, on the app's origin by their own link (the guest page's Add to calendar), when no
   * calendar event already put the meeting in their calendar. Only ever on the visitor's own mail.
   */
  readonly calendarUrl?: string;
  /** The visitor's booking page, where they reschedule or cancel: "Need a change? Reschedule · Cancel". Visitor only. */
  readonly change?: { readonly url: string };
  /** The footer's line saying where a reply goes ("Reply to reach Ada Host"), set with `replyTo`. */
  readonly reply?: string;
  /**
   * Where a reply goes: the host, on the visitor's mail once the booking stands. The visitor already has the host's
   * address there (the calendar invitation names them, whether ours or the host's calendar's), and the guest page's
   * "too close to change it here" line sends them to reply to their confirmation email.
   */
  readonly replyTo?: string;
}

/** What the emails need: the app's origin for links, the guest page key, the sender for the calendar file, the clock. */
export interface BookingMailDeps {
  readonly appOrigin: string;
  /** Where the public booking pages are served (`BOOKING_PUBLIC_ORIGIN`): the guest page and Book again; the app's when unset. */
  readonly publicOrigin?: string;
  readonly linkKey: ManageLinkKey;
  readonly organizerEmail: string;
  readonly now?: () => Date;
}

/** The messages for one queued kind, and the guests they invite (marked invited once sent). */
export interface PreparedMail {
  readonly messages: readonly BookingMail[];
  readonly invited: readonly string[];
  /** The guests told they were taken off (marked no longer invited once sent, so a return invites them again). */
  readonly uninvited?: readonly string[];
  /** Why nothing is sent, when nothing is. */
  readonly skipped?: string;
  /**
   * When the booking was last written, as epoch milliseconds: the send's
   * idempotency key, with the booking id and the kind. A retry of a send that
   * went through but looked like it failed (a timeout) reads the same booking
   * and keys the same, so nobody gets it twice; a later send of the same kind
   * (a second reschedule) follows a write, so it keys differently and goes.
   */
  readonly stamp?: number;
}

/**
 * Where it happens, in words, for a guest or for a host. A video call with no link made (no calendar that makes one)
 * never promises one: its host sends it (QA Q77).
 */
function whereOf(
  location: { readonly type: string; readonly value?: string },
  videoUrl: string | null,
  phone: string | undefined,
  reader: { readonly kind: 'guest'; readonly hostName: string } | { readonly kind: 'host' },
) {
  if (videoUrl !== null) return videoUrl;
  switch (location.type) {
    case 'video':
      return reader.kind === 'guest'
        ? `Video call. ${reader.hostName} will send you the link.`
        : 'Video call. No link was made. Send the guest one.';
    case 'phone':
      return phone === undefined ? 'Phone call' : `Phone call to ${phone}`;
    default:
      return location.value ?? '';
  }
}

/** A meeting's length in words: "30 min", "1 hour", "1 hour 30 min", "2 hours". */
function lengthWords(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourWords = `${String(hours)} ${hours === 1 ? 'hour' : 'hours'}`;
  return rest === 0 ? hourWords : `${hourWords} ${String(rest)} min`;
}

/** The call services a Join button names, by the call's host. */
const CALL_SERVICES: readonly { readonly host: RegExp; readonly name: string }[] = [
  { host: /^meet\.google\.com$/, name: 'Google Meet' },
  { host: /(^|\.)zoom\.us$/, name: 'Zoom' },
  { host: /^teams\.(microsoft|live)\.com$/, name: 'Microsoft Teams' },
  { host: /(^|\.)webex\.com$/, name: 'Webex' },
];

/** The call's service by its address ("Google Meet"), or undefined for one we don't name. */
function callService(url: string): string | undefined {
  try {
    const { hostname } = new URL(url);
    return CALL_SERVICES.find((each) => each.host.test(hostname))?.name;
  } catch {
    return undefined;
  }
}

/** A string answer, when the booking keeps one. */
function answer(answers: unknown, key: string): string | undefined {
  if (typeof answers !== 'object' || answers === null || !(key in answers)) return undefined;
  const value = (answers as Readonly<Record<string, unknown>>)[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** The guests already told they were taken off (`markGuestsTold`). */
function toldOffOf(answers: unknown): readonly string[] {
  if (typeof answers !== 'object' || answers === null || !('toldOff' in answers) || !Array.isArray(answers.toldOff)) {
    return [];
  }
  return answers.toldOff.filter((each): each is string => typeof each === 'string');
}

/** The guests already sent an invitation. */
function invitedOf(answers: unknown): readonly string[] {
  if (typeof answers !== 'object' || answers === null || !('invited' in answers) || !Array.isArray(answers.invited)) {
    return [];
  }
  return answers.invited.filter((each): each is string => typeof each === 'string');
}

/** How long before the meeting each reminder may still go: past this, it is stale and sends nothing. */
const REMINDER_WINDOW_MS = { reminder_24h: 25 * 3_600_000, reminder_1h: 2 * 3_600_000 } as const;

/**
 * The emails one queued kind sends for a booking, read now (see the header).
 * `scope` is the system's in the booking's workspace. A booking that is gone
 * sends nothing.
 */
export async function prepareBookingMail(
  scope: EngineScope,
  deps: BookingMailDeps,
  input: { readonly bookingId: string; readonly kind: BookingMailKind },
): Promise<PreparedMail> {
  const now = deps.now?.() ?? new Date();
  return inWorkspace(scope, async (tx) => {
    const [row] = await tx.select().from(bookings).where(eq(bookings.id, input.bookingId));
    if (row === undefined) return { messages: [], invited: [], skipped: 'gone' };
    const page = await loadPage(tx, row.pageId);
    if (page === undefined) return { messages: [], invited: [], skipped: 'gone' };
    const [host] = await tx
      .select({ name: members.name, email: members.email, status: members.status })
      .from(members)
      .where(eq(members.id, row.hostMemberId));
    // A round robin booking's every host (spec 0037, AC-1322): the organiser first, each told, all named.
    const team =
      page.kind === 'round_robin'
        ? await tx
            .select({ id: members.id, name: members.name, email: members.email })
            .from(bookingHosts)
            .innerJoin(
              members,
              and(eq(members.workspaceId, bookingHosts.workspaceId), eq(members.id, bookingHosts.memberId)),
            )
            .where(eq(bookingHosts.bookingId, row.id))
        : [];
    const hosts =
      team.length === 0
        ? host === undefined
          ? []
          : [host]
        : [...team].sort((a, b) =>
            a.id === row.hostMemberId ? -1 : b.id === row.hostMemberId ? 1 : a.name.localeCompare(b.name),
          );
    const [workspace] = await tx.select({ slug: workspaces.slug }).from(workspaces).limit(1);
    const names = hosts.map((each) => each.name);
    const hostName =
      names.length <= 1 ? (host?.name ?? 'Your host') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
    const { kind } = input;
    const stamp = row.updatedAt.getTime();
    const cancelled = row.status === 'cancelled';
    const isTeam = page.kind === 'round_robin';

    if (kind !== 'cancelled' && kind !== 'declined' && cancelled) {
      return { messages: [], invited: [], skipped: 'cancelled' };
    }
    // A request (spec 0062, AC-6203) hears only of itself until it is confirmed: no confirmation, move or reminder.
    if (row.approval === 'pending' && !REQUEST_KINDS.has(kind)) {
      return { messages: [], invited: [], skipped: 'requested' };
    }
    if (kind === 'reminder_24h' || kind === 'reminder_1h') {
      const ahead = row.startsAt.getTime() - now.getTime();
      if (ahead <= 0 || ahead > REMINDER_WINDOW_MS[kind]) return { messages: [], invited: [], skipped: 'stale' };
    }

    const token = await ensureManageToken(tx, deps.linkKey, row);
    const publicOrigin = deps.publicOrigin ?? deps.appOrigin;
    const manageUrl = `${publicOrigin}${managePath(page.publicKey, token)}`;
    const bookAgainUrl = `${publicOrigin}${await pagePath(tx, page)}`;
    // The host's button opens this booking itself on Bookings' List (B-20, 4 November 2026: "Open Bookings" left them
    // to find it); `open` is the List's address for the booking whose card shows. Ids only, never the guest's details.
    const bookingsUrl = `${deps.appOrigin}/w/${encodeURIComponent(workspace?.slug ?? '')}/bookings/list?open=${encodeURIComponent(row.id)}`;
    const name = `${page.title} with ${hostName}`;
    const hostZone = page.availability.timeZone;
    const note = answer(row.answers, 'note');
    const phone = answer(row.answers, 'phone');
    const where = whereOf(page.location, row.videoUrl, phone, { kind: 'guest', hostName });
    const whereForHost = whereOf(page.location, row.videoUrl, phone, { kind: 'host' });
    const guests = guestsOf(row.answers);
    // The page's own questions (spec 0057, AC-5714). An email is read by whoever it reaches, outside any member's
    // field rules, so an answer filed onto a People field stays on the record (where those rules apply) and the
    // email says how many; the answers kept with the booking only are written out, label then words.
    const stored = storedBookingAnswers(row.answers);
    const filedCount = stored.filter((each) => each.attributeId !== undefined).length;
    const answerRows = [
      ...stored.flatMap((each) => {
        const words = each.attributeId === undefined ? answerWords(each.value) : '';
        return words === '' ? [] : [{ label: each.label, value: words }];
      }),
      ...(filedCount === 0
        ? []
        : [
            {
              label: 'On their record',
              value:
                filedCount === 1
                  ? '1 more answer, saved on their person in Timefix.'
                  : `${String(filedCount)} more answers, saved on their person in Timefix.`,
            },
          ]),
    ];
    const addedLater = addedLaterOf(row.answers);
    /** A guest's calendar file on a move or cancel: when no calendar event invited them, they have only ours. */
    const guestFile = (method: 'REQUEST' | 'CANCEL', guest: string) =>
      hasEvent && !addedLater.includes(guest) ? {} : { ics: icsFile(method, [{ name: guest, email: guest }], 'guest') };
    const invited = invitedOf(row.answers);
    const bookedByHost = answer(row.answers, 'bookedBy') === 'host';
    const byGuest = row.updatedByType === 'booking';
    const hasEvent = row.meetingId !== null;
    /** The time in `zone`, drawn large on its own (never a row), struck through once it no longer stands. */
    const when = (zone: string, struck = false) => ({
      when: { ...whenParts(row.startsAt, row.endsAt, zone), ...(struck ? { struck: true } : {}) },
    });
    // What it is and how long: "Intro call, 30 min".
    const what = {
      label: 'What',
      value: `${page.title}, ${lengthWords(row.endsAt.getTime() - row.startsAt.getTime())}`,
    };
    /** The visitor's own one button when the meeting has a call: join it, the call's service named where it is known. */
    const service = row.videoUrl === null ? undefined : callService(row.videoUrl);
    const join =
      row.videoUrl === null
        ? undefined
        : { label: service === undefined ? 'Join the call' : `Join ${service}`, url: row.videoUrl };
    /** Where, beside a Join button: the call's service, since the button carries its address. */
    const whereBesideJoin = row.videoUrl === null ? where : (service ?? 'Video call');
    const preview = (zone: string) => whenLine(row.startsAt, row.endsAt, zone);
    const was = (zone: string) =>
      row.previousStartsAt === null
        ? []
        : [
            {
              label: 'Was',
              value: whenLine(
                row.previousStartsAt,
                new Date(row.previousStartsAt.getTime() + (row.endsAt.getTime() - row.startsAt.getTime())),
                zone,
              ),
            },
          ];
    /** "Their time" for a host, in the guest's zone, only when it isn't the host's (B-20). */
    const theirTime =
      row.visitorTimeZone !== '' && row.visitorTimeZone !== hostZone
        ? [{ label: 'Their time', value: whenLine(row.startsAt, row.endsAt, row.visitorTimeZone) }]
        : [];
    const reasonRow = row.cancelReason === null ? [] : [{ label: 'Reason', value: row.cancelReason }];
    /** A reason, in the reader's quote marks, for the visitor's own mail. */
    const quoted = (reason: string | null) => (reason === null ? {} : { quote: `“${reason}”` });
    // The file's link opens the reader's own way back to the booking: the visitor's booking page, the host's booking on
    // Bookings, and for a guest the page itself, since a guest never gets the visitor's link (see the header).
    const fileUrl = { visitor: manageUrl, host: bookingsUrl, guest: bookAgainUrl } as const;
    const icsFile = (
      method: 'REQUEST' | 'CANCEL',
      attendees: readonly { name: string; email: string }[],
      reader: keyof typeof fileUrl,
    ) => ({
      filename: icsFilename(method),
      method,
      content: buildBookingIcs({
        bookingId: row.id,
        uidDomain: new URL(deps.appOrigin).host,
        method,
        start: row.startsAt,
        end: row.endsAt,
        summary: name,
        // A cancelled file only takes the meeting off a calendar: it never carries the call's link or the visitor's note.
        description: method === 'CANCEL' ? '' : (note ?? ''),
        location:
          method === 'CANCEL'
            ? null
            : (row.videoUrl ??
              (page.location.type === 'address' || page.location.type === 'custom' ? page.location.value : null)),
        url: fileUrl[reader],
        organizerEmail: deps.organizerEmail,
        organizerName: hostName,
        attendees,
        // 0 for the first copy; after a move or cancel, the time it changed, so calendars take the new one.
        sequence: row.reschedules === 0 && !cancelled ? 0 : Math.floor(row.updatedAt.getTime() / 1000),
        now,
      }),
    });
    /** The file, unless the calendar event already put it in their calendar. */
    const ics = (
      method: 'REQUEST' | 'CANCEL',
      attendees: readonly { name: string; email: string }[],
      reader: keyof typeof fileUrl,
    ) => (hasEvent ? {} : { ics: icsFile(method, attendees, reader) });
    const visitor = { name: row.visitorName, email: row.visitorEmail };
    // The host is in the meeting by default (the owner, 22 Oct 2026): every calendar file lists the hosts beside the
    // visitor, and a host gets the file too whenever no calendar event put the meeting in their own calendar.
    const everyone = [visitor, ...hosts.map((each) => ({ name: each.name, email: each.email }))];
    /** A host's own copy of the calendar file, when no calendar event holds the meeting and no other email goes. */
    const hostCopies = (method: 'REQUEST' | 'CANCEL', subject: string, intro: string): BookingMail[] =>
      hasEvent
        ? []
        : hosts.map((each) => ({
            to: each.email,
            subject,
            preview: preview(hostZone),
            heading: method === 'CANCEL' ? 'Off your calendar' : 'In your calendar',
            intro,
            ...when(hostZone, method === 'CANCEL'),
            rows: [
              { label: 'Who', value: `${row.visitorName} (${row.visitorEmail})` },
              { label: 'Where', value: whereForHost },
            ],
            button: { label: 'Open booking', url: bookingsUrl },
            why: hostWhy,
            ics: icsFile(method, everyone, 'host'),
          }));
    // The visitor's way to change it: Reschedule and Cancel, both on their booking page.
    const change = { change: { url: manageUrl } };
    // The visitor's calendar file by their own link, on the app's origin, unless a calendar event already invited them.
    const calendarLink = hasEvent
      ? {}
      : { calendarUrl: `${deps.appOrigin}/api/public/booking/manage/${encodeURIComponent(token)}/ics` };
    // Why each reader got their email, for the footer: the address that booked, a guest on it, or its host.
    const visitorWhy = bookedByHost
      ? `You got this email because ${hostName} booked a time with this address.`
      : `You got this email because this address was used to book ${page.title} with ${hostName}.`;
    // A reply to the visitor's mail reaches the organising host (see `replyTo`); a request's mail, before any invitation
    // named them, keeps the sending address.
    // Only to an active member (as every queued email's reply, emails/send.ts), and only to the address the visitor has
    // already seen: our calendar file lists each host's member address, and so does the calendar event of a page's
    // booking or of a host booking themselves in. A member who booked them in for a colleague put the event on that
    // colleague's calendar, whose account may show another address as the organiser, so nothing is shared there.
    const bookedForColleague = bookedByHost && row.createdByMemberId !== row.hostMemberId;
    const replyToHost =
      host === undefined || host.status !== 'active' || (hasEvent && bookedForColleague)
        ? {}
        : { replyTo: host.email, reply: `Reply to reach ${host.name}` };
    const guestWhy = `You got this email because ${row.visitorName} added this address to ${page.title}.`;
    const hostWhy = `You got this email because you host ${page.title}.`;
    const newGuests = guests.filter((guest) => !invited.includes(guest));
    const invitations = (always: boolean): BookingMail[] =>
      newGuests.map((guest) => ({
        to: guest,
        subject: `Invitation: ${name}`,
        preview: `${row.visitorName} added you to ${page.title}.`,
        heading: 'You’re invited',
        intro: `${row.visitorName} invited you to ${page.title}, hosted by ${hostName}.`,
        ...when(row.visitorTimeZone),
        rows: [what, { label: 'Where', value: join === undefined ? where : whereBesideJoin }],
        // The call, when there is one, is the guest's one button (never the visitor's booking page: their key).
        ...(join === undefined ? {} : { button: join }),
        why: guestWhy,
        ...(always
          ? { ics: icsFile('REQUEST', [{ name: guest, email: guest }], 'guest') }
          : ics('REQUEST', [{ name: guest, email: guest }], 'guest')),
      }));

    switch (kind) {
      case 'confirmed': {
        const toVisitor: BookingMail = {
          to: row.visitorEmail,
          subject: bookedByHost ? `${hostName} booked a time with you` : `Booked: ${name}`,
          preview: preview(row.visitorTimeZone),
          heading: bookedByHost ? `${hostName} booked a time with you` : `You’re booked with ${hostName}`,
          // The heading names the host and the time follows: an intro would only say it again.
          intro: bookedByHost ? `You didn’t book this: ${hostName} did, and it’s in both your calendars.` : '',
          ...when(row.visitorTimeZone),
          rows: [
            what,
            // A round robin booking names its assigned host beside their initials instead (`host`).
            ...(isTeam ? [] : [{ label: 'With', value: hostName }]),
            { label: 'Where', value: whereBesideJoin },
            ...(bookedByHost && note !== undefined ? [{ label: 'Message', value: `“${note}”` }] : []),
          ],
          ...(isTeam ? { host: { label: 'Your host', name: hostName } } : {}),
          // The one button: the call when there is one (the booking page is a link under it), else the booking page.
          button: join ?? { label: 'View your booking', url: manageUrl },
          ...calendarLink,
          ...change,
          why: visitorWhy,
          ...replyToHost,
          ...ics('REQUEST', everyone, 'visitor'),
        };
        const toHost: BookingMail[] = bookedByHost
          ? hostCopies(
              'REQUEST',
              `Booked: ${page.title} with ${row.visitorName}`,
              `You booked ${page.title} with ${row.visitorName}. Here it is for your calendar.`,
            )
          : hosts.map((each): BookingMail => ({
              to: each.email,
              subject: `New booking: ${page.title} with ${row.visitorName}`,
              preview: preview(hostZone),
              heading: 'New booking',
              intro: `${row.visitorName} booked ${page.title}.`,
              ...when(hostZone),
              rows: [
                // The guest's own clock (B-20): the host writes to them in it, so it is said when it isn't the host's.
                ...theirTime,
                { label: 'Who', value: `${row.visitorName} (${row.visitorEmail})` },
                ...(guests.length === 0 ? [] : [{ label: 'Guests', value: guests.join(', ') }]),
                { label: 'Where', value: whereForHost },
                ...(note === undefined ? [] : [{ label: 'Note', value: note }]),
                // The page's own questions (spec 0057, AC-5714), label then answer; drawn as text, never markup.
                ...answerRows,
              ],
              button: { label: 'Open booking', url: bookingsUrl },
              why: hostWhy,
              ...ics('REQUEST', everyone, 'host'),
            }));
        return { messages: [toVisitor, ...toHost, ...invitations(false)], invited: newGuests, stamp };
      }
      case 'guests': {
        // Invited, then taken off on the guest page: told once, with a cancelled file where ours invited them. Told
        // at most once per booking, so taking someone off and adding them back can't be used to mail them over and over.
        const toldOff = toldOffOf(row.answers);
        const removed = invited.filter((guest) => !guests.includes(guest) && !toldOff.includes(guest));
        // Whoever took them off: the visitor on the guest page, or a host from Bookings.
        const remover = byGuest ? row.visitorName : hostName;
        const removals: BookingMail[] = removed.map((guest) => ({
          to: guest,
          subject: `No longer invited: ${name}`,
          preview: `${remover} took you off ${page.title}.`,
          heading: 'You’re no longer invited',
          intro: byGuest
            ? `${remover} took you off ${page.title}, hosted by ${hostName}. Nothing else to do.`
            : `${remover} took you off ${page.title}. Nothing else to do.`,
          ...when(row.visitorTimeZone),
          rows: [what],
          why: `You got this email because ${row.visitorName} had added this address to ${page.title}.`,
          ...guestFile('CANCEL', guest),
        }));
        // A guest who invites people from their page tells the host, once per new guest (a host adding them knows).
        const toHost: BookingMail[] =
          byGuest && newGuests.length > 0
            ? hosts.map((each): BookingMail => ({
                to: each.email,
                subject: `Guests added: ${page.title} with ${row.visitorName}`,
                preview: `${row.visitorName} invited ${newGuests.join(', ')}.`,
                heading: 'Guests added',
                intro: `${row.visitorName} invited ${newGuests.join(', ')} to ${page.title}. They have the calendar file.`,
                ...when(hostZone),
                rows: [
                  { label: 'Who', value: `${row.visitorName} (${row.visitorEmail})` },
                  { label: 'Guests', value: guests.join(', ') },
                ],
                button: { label: 'Open booking', url: bookingsUrl },
                why: hostWhy,
              }))
            : [];
        return {
          messages: [...invitations(true), ...removals, ...toHost],
          invited: newGuests,
          uninvited: removed,
          stamp,
        };
      }
      case 'moved': {
        const toVisitor: BookingMail = {
          to: row.visitorEmail,
          subject: `Moved: ${name}`,
          preview: preview(row.visitorTimeZone),
          heading: byGuest ? 'Your booking moved' : `${hostName} moved your booking`,
          intro: byGuest
            ? `${hostName} has been told, and the calendar invitation has the new time.`
            : `${hostName} picked a new time. If it doesn’t suit you, move it again or cancel it.`,
          ...when(row.visitorTimeZone),
          rows: [what, ...was(row.visitorTimeZone), { label: 'Where', value: whereBesideJoin }],
          button: join ?? { label: 'View your booking', url: manageUrl },
          ...calendarLink,
          ...change,
          why: visitorWhy,
          ...replyToHost,
          ...ics('REQUEST', everyone, 'visitor'),
        };
        const toGuests: BookingMail[] = guests.map((guest) => ({
          to: guest,
          subject: `Moved: ${name}`,
          preview: preview(row.visitorTimeZone),
          heading: 'A meeting you’re invited to moved',
          intro: `${page.title} has a new time.`,
          ...when(row.visitorTimeZone),
          rows: [...was(row.visitorTimeZone), { label: 'Where', value: join === undefined ? where : whereBesideJoin }],
          ...(join === undefined ? {} : { button: join }),
          why: guestWhy,
          ...guestFile('REQUEST', guest),
        }));
        const toHost: BookingMail[] = !byGuest
          ? hostCopies(
              'REQUEST',
              `Moved: ${page.title} with ${row.visitorName}`,
              `${page.title} with ${row.visitorName} has a new time. Here it is for your calendar.`,
            )
          : hosts.map((each): BookingMail => ({
              to: each.email,
              subject: `Moved by guest: ${page.title} with ${row.visitorName}`,
              preview: preview(hostZone),
              heading: 'A booking moved',
              intro: `${row.visitorName} moved ${page.title} to a new time.`,
              ...when(hostZone),
              rows: [...was(hostZone), { label: 'Who', value: `${row.visitorName} (${row.visitorEmail})` }],
              button: { label: 'Open booking', url: bookingsUrl },
              why: hostWhy,
              ...ics('REQUEST', everyone, 'host'),
            }));
        return { messages: [toVisitor, ...toGuests, ...toHost], invited: [], stamp };
      }
      case 'cancelled': {
        if (!cancelled) return { messages: [], invited: [], skipped: 'not cancelled' };
        const byHost = row.cancelledBy !== 'guest';
        const toVisitor: BookingMail = {
          to: row.visitorEmail,
          subject: `Cancelled: ${name}`,
          preview: preview(row.visitorTimeZone),
          heading: byHost ? `${hostName} cancelled your booking` : 'Your booking is cancelled',
          intro: byHost
            ? `${hostName} cancelled ${page.title}. It comes off your calendar.`
            : `${hostName} has been told. Nothing else to do.`,
          ...when(row.visitorTimeZone, true),
          rows: [what],
          ...quoted(row.cancelReason),
          button: { label: byHost ? 'Book another time' : 'Book again', url: bookAgainUrl },
          why: visitorWhy,
          ...replyToHost,
          ...ics('CANCEL', everyone, 'visitor'),
        };
        const toGuests: BookingMail[] = guests.map((guest) => ({
          to: guest,
          subject: `Cancelled: ${name}`,
          preview: preview(row.visitorTimeZone),
          heading: 'A meeting you’re invited to was cancelled',
          intro: `${page.title} won’t go ahead.`,
          ...when(row.visitorTimeZone, true),
          rows: [what],
          why: guestWhy,
          ...guestFile('CANCEL', guest),
        }));
        const toHost: BookingMail[] = byHost
          ? hostCopies(
              'CANCEL',
              `Cancelled: ${page.title} with ${row.visitorName}`,
              `${page.title} with ${row.visitorName} is cancelled. It comes off your calendar.`,
            )
          : hosts.map((each): BookingMail => ({
              to: each.email,
              subject: `Cancelled by guest: ${page.title} with ${row.visitorName}`,
              preview: preview(hostZone),
              heading: 'A booking was cancelled',
              intro: `${row.visitorName} cancelled ${page.title}. The time is free again.`,
              ...when(hostZone, true),
              rows: [{ label: 'Who', value: `${row.visitorName} (${row.visitorEmail})` }, ...reasonRow],
              why: hostWhy,
              ...ics('CANCEL', everyone, 'host'),
            }));
        return { messages: [toVisitor, ...toGuests, ...toHost], invited: [], stamp };
      }
      case 'meeting_link': {
        // A link the host added by hand (B-07): the visitor and their guests get it, with a fresh calendar file
        // where no calendar event holds the meeting. The host added it, so they get nothing.
        if (row.videoUrl === null) return { messages: [], invited: [], skipped: 'no link' };
        const call = join ?? { label: 'Join the call', url: row.videoUrl };
        const toVisitor: BookingMail = {
          to: row.visitorEmail,
          subject: `Meeting link: ${name}`,
          preview: preview(row.visitorTimeZone),
          heading: 'Your meeting link',
          intro: `${hostName} added the link for ${page.title}.`,
          ...when(row.visitorTimeZone),
          rows: [what, { label: 'Where', value: whereBesideJoin }],
          button: call,
          ...calendarLink,
          ...change,
          why: visitorWhy,
          ...replyToHost,
          ...ics('REQUEST', everyone, 'visitor'),
        };
        const toGuests: BookingMail[] = guests.map((guest) => ({
          to: guest,
          subject: `Meeting link: ${name}`,
          preview: preview(row.visitorTimeZone),
          heading: 'The meeting link',
          intro: `${hostName} added the link for ${page.title}.`,
          ...when(row.visitorTimeZone),
          rows: [{ label: 'Where', value: whereBesideJoin }],
          button: call,
          why: guestWhy,
          ...guestFile('REQUEST', guest),
        }));
        return { messages: [toVisitor, ...toGuests], invited: [], stamp };
      }
      case 'host_changed':
      case 'approved':
      case 'pending_expire':
        // Not emails: the worker writes the calendar event (`remakeEvent`), or declines a request left unanswered.
        return { messages: [], invited: [], skipped: 'not an email' };
      case 'requested': {
        // A request (spec 0062, AC-6203): the visitor hears it was received, each host is asked to answer it.
        if (row.approval !== 'pending') return { messages: [], invited: [], skipped: 'answered' };
        const [manager] = await tx
          .select({ email: members.email })
          .from(members)
          .where(eq(members.id, page.ownerMemberId));
        const managerEmail = manager?.email;
        const expires = new Date(
          Math.min(row.createdAt.getTime() + REQUEST_WAIT_MS, row.startsAt.getTime() - REQUEST_LEAD_MS),
        );
        const toVisitor: BookingMail = {
          to: row.visitorEmail,
          subject: `Request received: ${name}`,
          preview: preview(row.visitorTimeZone),
          heading: 'Request received',
          intro: `${hostName} will confirm or decline it. You’ll get an email either way.`,
          ...when(row.visitorTimeZone),
          rows: [what, ...(isTeam ? [] : [{ label: 'With', value: hostName }])],
          button: { label: 'View your request', url: manageUrl },
          why: visitorWhy,
        };
        const editorUrl = `${deps.appOrigin}/w/${encodeURIComponent(workspace?.slug ?? '')}/captures/links/${row.pageId}`;
        // The page's own manager answers in its editor; a host who may not change the page, from Bookings.
        const requestsUrl = (email: string) => (email === managerEmail ? editorUrl : bookingsUrl);
        const toHost: BookingMail[] = hosts.map((each) => ({
          to: each.email,
          subject: `Booking request: ${page.title} with ${row.visitorName}`,
          preview: preview(hostZone),
          heading: 'A booking request',
          intro: `${row.visitorName} asked for ${page.title}. The time is held until you answer.`,
          ...when(hostZone),
          rows: [
            { label: 'Who', value: `${row.visitorName} (${row.visitorEmail})` },
            ...(note === undefined ? [] : [{ label: 'Note', value: note }]),
            ...answerRows,
            { label: 'Answer by', value: atLine(expires, hostZone) },
          ],
          button: { label: 'Confirm or decline', url: requestsUrl(each.email) },
          footnote: 'Left unanswered, it declines itself and the visitor is told.',
          why: hostWhy,
        }));
        return { messages: [toVisitor, ...toHost], invited: [], stamp };
      }
      case 'declined': {
        if (!cancelled || row.approval !== 'declined') return { messages: [], invited: [], skipped: 'not declined' };
        const byNobody = row.decidedByMemberId === null;
        const toVisitor: BookingMail = {
          to: row.visitorEmail,
          subject: `Declined: ${name}`,
          preview: preview(row.visitorTimeZone),
          heading: byNobody ? 'Your request wasn’t confirmed' : `${hostName} declined your request`,
          intro: byNobody
            ? `${hostName} didn’t answer in time, so the time is free again.`
            : `${hostName} can’t take this time.`,
          ...when(row.visitorTimeZone, true),
          rows: [what],
          ...quoted(row.declineReason),
          button: { label: 'Book another time', url: bookAgainUrl },
          why: visitorWhy,
        };
        return { messages: [toVisitor], invited: [], stamp };
      }
      case 'needs_host': {
        // A booking whose host left with nobody free to take it (spec 0029, AC-749): the admins are told.
        if (row.needsHostAt === null) return { messages: [], invited: [], skipped: 'has a host' };
        // Everyone who manages everyone's scheduling (spec 0037, J9), read by the permission they hold now.
        const admins = await schedulingManagers(tx, scope.workspaceId);
        return {
          messages: admins.map((admin) => ({
            to: admin.email,
            subject: `Needs a host: ${page.title} with ${row.visitorName}`,
            preview: preview(hostZone),
            heading: 'A booking needs a host',
            intro: `Its host left the workspace and nobody else was free to take ${page.title} with ${row.visitorName}. Reassign it or cancel it from Bookings.`,
            ...when(hostZone),
            rows: [{ label: 'Who', value: `${row.visitorName} (${row.visitorEmail})` }],
            button: { label: 'Open booking', url: bookingsUrl },
            why: 'You got this email because you manage scheduling in this workspace.',
          })),
          invited: [],
        };
      }
      case 'reassigned': {
        // Who left and who came, from the ledger's latest change (spec 0029, AC-746, AC-748, AC-749).
        const rows = await tx
          .select({
            memberId: rotationAssignments.memberId,
            createdAt: rotationAssignments.createdAt,
            voidedAt: rotationAssignments.voidedAt,
            name: members.name,
            email: members.email,
            status: members.status,
          })
          .from(rotationAssignments)
          .innerJoin(
            members,
            and(eq(members.workspaceId, rotationAssignments.workspaceId), eq(members.id, rotationAssignments.memberId)),
          )
          .where(eq(rotationAssignments.bookingId, row.id));
        const lastVoid = Math.max(0, ...rows.map((each) => each.voidedAt?.getTime() ?? 0));
        const current = new Set(team.map((each) => each.id));
        const left = rows.filter(
          (each) => each.voidedAt?.getTime() === lastVoid && !current.has(each.memberId) && each.status === 'active',
        );
        const came = team.filter((each) =>
          rows.some(
            (ledger) =>
              ledger.memberId === each.id && ledger.voidedAt === null && ledger.createdAt.getTime() >= lastVoid,
          ),
        );
        if (lastVoid === 0 || came.length === 0) return { messages: [], invited: [], skipped: 'no change' };
        const toVisitor: BookingMail = {
          to: row.visitorEmail,
          subject: `Your meeting is now with ${hostName}`,
          preview: preview(row.visitorTimeZone),
          heading: `Your meeting is now with ${hostName}`,
          intro: `${page.title} has a new host. The time and place stay the same, and a new calendar invitation is on its way.`,
          ...when(row.visitorTimeZone),
          rows: [what, { label: 'Where', value: whereBesideJoin }],
          host: { label: 'Your new host', name: hostName },
          button: join ?? { label: 'View your booking', url: manageUrl },
          ...calendarLink,
          ...change,
          why: visitorWhy,
          ...replyToHost,
          ...ics('REQUEST', everyone, 'visitor'),
        };
        const toCame: BookingMail[] = came.map((each) => ({
          to: each.email,
          subject: `New booking: ${page.title} with ${row.visitorName}`,
          preview: preview(hostZone),
          heading: 'A booking is now yours',
          intro: `${page.title} with ${row.visitorName} came to you through its rotation.`,
          ...when(hostZone),
          rows: [
            { label: 'Who', value: `${row.visitorName} (${row.visitorEmail})` },
            { label: 'Where', value: whereForHost },
            ...(note === undefined ? [] : [{ label: 'Note', value: note }]),
          ],
          button: { label: 'Open booking', url: bookingsUrl },
          why: hostWhy,
          ...ics('REQUEST', everyone, 'host'),
        }));
        const toLeft: BookingMail[] = left.map((each) => ({
          to: each.email,
          subject: `Reassigned: ${page.title} with ${row.visitorName}`,
          preview: preview(hostZone),
          heading: 'A booking moved to someone else',
          intro: `${page.title} with ${row.visitorName} is now with ${hostName}. It’s off your calendar.`,
          ...when(hostZone),
          rows: [{ label: 'Who', value: `${row.visitorName} (${row.visitorEmail})` }],
          button: { label: 'Open booking', url: bookingsUrl },
          why: `You got this email because you hosted ${page.title}.`,
          // Off the calendar the file put it in: a cancel for this host alone.
          ...ics('CANCEL', [{ name: each.name, email: each.email }], 'host'),
        }));
        return { messages: [toVisitor, ...toCame, ...toLeft], invited: [], stamp };
      }
      case 'reminder_24h':
      case 'reminder_1h': {
        const soon = kind === 'reminder_1h' ? 'in an hour' : 'tomorrow';
        return {
          messages: [
            {
              to: row.visitorEmail,
              subject: `${kind === 'reminder_1h' ? 'In an hour' : 'Tomorrow'}: ${name}`,
              preview: preview(row.visitorTimeZone),
              heading: `Your booking is ${soon}`,
              intro: `A reminder of your time with ${hostName}.`,
              ...when(row.visitorTimeZone),
              rows: [what, { label: 'Where', value: whereBesideJoin }],
              // Join the call when there is one; the booking page is then the quiet Reschedule · Cancel under it.
              button: join ?? { label: 'View your booking', url: manageUrl },
              ...calendarLink,
              ...change,
              why: visitorWhy,
              ...replyToHost,
            },
          ],
          invited: [],
        };
      }
    }
  });
}

/**
 * Notes what a run of the booking mail told its guests, in one write, so a retry can't send a removal twice: guests
 * invited go on the invited list, so a later change never invites them twice; guests told they were taken off leave
 * it (adding them back invites them again) and go on the told list, so a second removal says nothing more (at most
 * an invitation, a removal and one more invitation).
 */
export async function markGuestsTold(
  scope: EngineScope,
  bookingId: string,
  told: { readonly invited: readonly string[]; readonly uninvited?: readonly string[] },
): Promise<void> {
  const uninvited = told.uninvited ?? [];
  if (told.invited.length === 0 && uninvited.length === 0) return;
  await inWorkspace(scope, async (tx) => {
    if (told.invited.length > 0) {
      await tx
        .update(bookings)
        .set({
          answers: sql`jsonb_set(${bookings.answers}, '{invited}', coalesce(${bookings.answers}->'invited', '[]'::jsonb) || ${JSON.stringify(told.invited)}::jsonb)`,
        })
        .where(eq(bookings.id, bookingId));
    }
    if (uninvited.length > 0) {
      const off = JSON.stringify(uninvited);
      await tx
        .update(bookings)
        .set({
          answers: sql`jsonb_set(jsonb_set(${bookings.answers}, '{invited}', (select coalesce(jsonb_agg(each), '[]'::jsonb) from jsonb_array_elements(coalesce(${bookings.answers}->'invited', '[]'::jsonb)) as each where not (${off}::jsonb @> jsonb_build_array(each)))), '{toldOff}', coalesce(${bookings.answers}->'toldOff', '[]'::jsonb) || ${off}::jsonb)`,
        })
        .where(eq(bookings.id, bookingId));
    }
  });
}
