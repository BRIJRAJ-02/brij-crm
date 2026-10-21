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
//   later is not on the calendar event's invitation).
// - reminders: the visitor, 24 hours and 1 hour before, only while the
//   booking is confirmed and that close (a stale reminder sends nothing).
// A guest never gets the visitor's link: it is the visitor's key.
import { and, eq, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { schema } from '@crm/db';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { addedLaterOf, guestsOf } from './change.ts';
import { buildBookingIcs } from './ics.ts';
import type { BookingMailKind } from './mail-queue.ts';
import { loadPage } from './slots.ts';
import { ensureManageToken, managePath, type ManageLinkKey } from './tokens.ts';

const { bookingHosts, bookings, members, rotationAssignments, workspaces } = schema;

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
}

/** What the emails need: the app's origin for links, the guest page key, the sender for the calendar file, the clock. */
export interface BookingMailDeps {
  readonly appOrigin: string;
  readonly linkKey: ManageLinkKey;
  readonly organizerEmail: string;
  readonly now?: () => Date;
}

/** The messages for one queued kind, and the guests they invite (marked invited once sent). */
export interface PreparedMail {
  readonly messages: readonly BookingMail[];
  readonly invited: readonly string[];
  /** Why nothing is sent, when nothing is. */
  readonly skipped?: string;
}

/** "Monday 2 November 2026, 9:00 AM to 9:30 AM (Europe/London)", in `zone`. */
export function whenLine(start: Date, end: Date, zone: string): string {
  const from = DateTime.fromJSDate(start, { zone }).setLocale('en-GB');
  const to = DateTime.fromJSDate(end, { zone }).setLocale('en-GB');
  const time = (at: DateTime) => at.setLocale('en-US').toFormat('h:mm a');
  return `${from.toFormat('cccc d LLLL yyyy')}, ${time(from)} to ${time(to)} (${zone.replace(/_/g, ' ')})`;
}

/** Where it happens, in words. */
function whereOf(
  location: { readonly type: string; readonly value?: string },
  videoUrl: string | null,
  phone?: string,
) {
  if (videoUrl !== null) return videoUrl;
  switch (location.type) {
    case 'video':
      return 'Video call (the link comes with the calendar invitation)';
    case 'phone':
      return phone === undefined ? 'Phone call' : `Phone call to ${phone}`;
    default:
      return location.value ?? '';
  }
}

/** A string answer, when the booking keeps one. */
function answer(answers: unknown, key: string): string | undefined {
  if (typeof answers !== 'object' || answers === null || !(key in answers)) return undefined;
  const value = (answers as Readonly<Record<string, unknown>>)[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
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
      .select({ name: members.name, email: members.email })
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
    const cancelled = row.status === 'cancelled';

    if (kind !== 'cancelled' && cancelled) return { messages: [], invited: [], skipped: 'cancelled' };
    if (kind === 'reminder_24h' || kind === 'reminder_1h') {
      const ahead = row.startsAt.getTime() - now.getTime();
      if (ahead <= 0 || ahead > REMINDER_WINDOW_MS[kind]) return { messages: [], invited: [], skipped: 'stale' };
    }

    const token = await ensureManageToken(tx, deps.linkKey, row);
    const manageUrl = `${deps.appOrigin}${managePath(page.publicKey, token)}`;
    const bookAgainUrl = `${deps.appOrigin}/b/${encodeURIComponent(page.publicKey)}`;
    const bookingsUrl = `${deps.appOrigin}/w/${encodeURIComponent(workspace?.slug ?? '')}/bookings/list`;
    const name = `${page.title} with ${hostName}`;
    const hostZone = page.availability.timeZone;
    const note = answer(row.answers, 'note');
    const where = whereOf(page.location, row.videoUrl, answer(row.answers, 'phone'));
    const guests = guestsOf(row.answers);
    const addedLater = addedLaterOf(row.answers);
    /** A guest's calendar file on a move or cancel: when no calendar event invited them, they have only ours. */
    const guestFile = (method: 'REQUEST' | 'CANCEL', guest: string) =>
      hasEvent && !addedLater.includes(guest) ? {} : { ics: icsFile(method, [{ name: guest, email: guest }]) };
    const invited = invitedOf(row.answers);
    const bookedByHost = answer(row.answers, 'bookedBy') === 'host';
    const byGuest = row.updatedByType === 'booking';
    const hasEvent = row.meetingId !== null;
    const when = (zone: string) => ({ label: 'When', value: whenLine(row.startsAt, row.endsAt, zone) });
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
    const reasonRow = row.cancelReason === null ? [] : [{ label: 'Reason', value: row.cancelReason }];
    const icsFile = (method: 'REQUEST' | 'CANCEL', attendees: readonly { name: string; email: string }[]) => ({
      filename: method === 'CANCEL' ? 'cancelled.ics' : 'invite.ics',
      method,
      content: buildBookingIcs({
        bookingId: row.id,
        uidDomain: new URL(deps.appOrigin).host,
        method,
        start: row.startsAt,
        end: row.endsAt,
        summary: name,
        description: note ?? '',
        location:
          row.videoUrl ??
          (page.location.type === 'address' || page.location.type === 'custom' ? page.location.value : null),
        url: bookAgainUrl,
        organizerEmail: deps.organizerEmail,
        organizerName: hostName,
        attendees,
        // 0 for the first copy; after a move or cancel, the time it changed, so calendars take the new one.
        sequence: row.reschedules === 0 && !cancelled ? 0 : Math.floor(row.updatedAt.getTime() / 1000),
        now,
      }),
    });
    /** The file, unless the calendar event already put it in their calendar. */
    const ics = (method: 'REQUEST' | 'CANCEL', attendees: readonly { name: string; email: string }[]) =>
      hasEvent ? {} : { ics: icsFile(method, attendees) };
    const visitor = { name: row.visitorName, email: row.visitorEmail };
    const change = 'Need to change it? Move it to another time or cancel it from your booking page.';
    // Why each reader got their email, for the footer: the address that booked, a guest on it, or its host.
    const visitorWhy = bookedByHost
      ? `You got this email because ${hostName} booked a time with this address.`
      : `You got this email because this address was used to book ${page.title} with ${hostName}.`;
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
        rows: [{ label: 'What', value: page.title }, when(row.visitorTimeZone), { label: 'Where', value: where }],
        why: guestWhy,
        ...(always
          ? { ics: icsFile('REQUEST', [{ name: guest, email: guest }]) }
          : ics('REQUEST', [{ name: guest, email: guest }])),
      }));

    switch (kind) {
      case 'confirmed': {
        const toVisitor: BookingMail = {
          to: row.visitorEmail,
          subject: bookedByHost ? `${hostName} booked a time with you` : `Booked: ${name}`,
          preview: preview(row.visitorTimeZone),
          heading: bookedByHost ? `${hostName} booked a time with you` : 'You’re booked',
          intro: bookedByHost
            ? `You didn’t book this: ${hostName} did, and it’s in both your calendars.`
            : `${hostName} has been told. Here are the details.`,
          rows: [
            { label: 'What', value: page.title },
            when(row.visitorTimeZone),
            { label: 'With', value: hostName },
            { label: 'Where', value: where },
            ...(bookedByHost && note !== undefined ? [{ label: 'Message', value: `“${note}”` }] : []),
          ],
          button: { label: 'View your booking', url: manageUrl },
          footnote: change,
          why: visitorWhy,
          ...ics('REQUEST', [visitor]),
        };
        const toHost: BookingMail[] = bookedByHost
          ? []
          : hosts.map((each): BookingMail => ({
              to: each.email,
              subject: `New booking: ${page.title} with ${row.visitorName}`,
              preview: preview(hostZone),
              heading: 'New booking',
              intro: `${row.visitorName} booked ${page.title}.`,
              rows: [
                when(hostZone),
                { label: 'Who', value: `${row.visitorName} (${row.visitorEmail})` },
                ...(guests.length === 0 ? [] : [{ label: 'Guests', value: guests.join(', ') }]),
                { label: 'Where', value: where },
                ...(note === undefined ? [] : [{ label: 'Note', value: note }]),
              ],
              button: { label: 'Open Bookings', url: bookingsUrl },
              why: hostWhy,
            }));
        return { messages: [toVisitor, ...toHost, ...invitations(false)], invited: newGuests };
      }
      case 'guests':
        return { messages: invitations(true), invited: newGuests };
      case 'moved': {
        const toVisitor: BookingMail = {
          to: row.visitorEmail,
          subject: `Moved: ${name}`,
          preview: preview(row.visitorTimeZone),
          heading: byGuest ? 'Your booking moved' : `${hostName} moved your booking`,
          intro: byGuest
            ? `${hostName} has been told, and the calendar invitation has the new time.`
            : `${hostName} picked a new time. If it doesn’t suit you, move it again or cancel it.`,
          rows: [
            { label: 'What', value: page.title },
            when(row.visitorTimeZone),
            ...was(row.visitorTimeZone),
            { label: 'Where', value: where },
          ],
          button: { label: 'View your booking', url: manageUrl },
          footnote: change,
          why: visitorWhy,
          ...ics('REQUEST', [visitor]),
        };
        const toGuests: BookingMail[] = guests.map((guest) => ({
          to: guest,
          subject: `Moved: ${name}`,
          preview: preview(row.visitorTimeZone),
          heading: 'A meeting you’re invited to moved',
          intro: `${page.title} has a new time.`,
          rows: [when(row.visitorTimeZone), ...was(row.visitorTimeZone), { label: 'Where', value: where }],
          why: guestWhy,
          ...guestFile('REQUEST', guest),
        }));
        const toHost: BookingMail[] = !byGuest
          ? []
          : hosts.map((each): BookingMail => ({
              to: each.email,
              subject: `Moved by guest: ${page.title} with ${row.visitorName}`,
              preview: preview(hostZone),
              heading: 'A booking moved',
              intro: `${row.visitorName} moved ${page.title} to a new time.`,
              rows: [
                when(hostZone),
                ...was(hostZone),
                { label: 'Who', value: `${row.visitorName} (${row.visitorEmail})` },
              ],
              button: { label: 'Open Bookings', url: bookingsUrl },
              why: hostWhy,
            }));
        return { messages: [toVisitor, ...toGuests, ...toHost], invited: [] };
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
            : 'It comes off both calendars. Nothing else to do.',
          rows: [{ label: 'What', value: page.title }, when(row.visitorTimeZone), ...reasonRow],
          button: { label: byHost ? 'Book another time' : 'Book again', url: bookAgainUrl },
          why: visitorWhy,
          ...ics('CANCEL', [visitor]),
        };
        const toGuests: BookingMail[] = guests.map((guest) => ({
          to: guest,
          subject: `Cancelled: ${name}`,
          preview: preview(row.visitorTimeZone),
          heading: 'A meeting you’re invited to was cancelled',
          intro: `${page.title} won’t go ahead.`,
          rows: [when(row.visitorTimeZone)],
          why: guestWhy,
          ...guestFile('CANCEL', guest),
        }));
        const toHost: BookingMail[] = byHost
          ? []
          : hosts.map((each): BookingMail => ({
              to: each.email,
              subject: `Cancelled by guest: ${page.title} with ${row.visitorName}`,
              preview: preview(hostZone),
              heading: 'A booking was cancelled',
              intro: `${row.visitorName} cancelled ${page.title}. The time is free again.`,
              rows: [when(hostZone), { label: 'Who', value: `${row.visitorName} (${row.visitorEmail})` }, ...reasonRow],
              why: hostWhy,
            }));
        return { messages: [toVisitor, ...toGuests, ...toHost], invited: [] };
      }
      case 'needs_host': {
        // A booking whose host left with nobody free to take it (spec 0029, AC-749): the admins are told.
        if (row.needsHostAt === null) return { messages: [], invited: [], skipped: 'has a host' };
        const admins = await tx
          .select({ email: members.email })
          .from(members)
          .where(and(eq(members.status, 'active'), sql`${members.role} in ('owner', 'admin')`));
        return {
          messages: admins.map((admin) => ({
            to: admin.email,
            subject: `Needs a host: ${page.title} with ${row.visitorName}`,
            preview: preview(hostZone),
            heading: 'A booking needs a host',
            intro: `Its host left the workspace and nobody else was free to take ${page.title} with ${row.visitorName}. Reassign it or cancel it from Bookings.`,
            rows: [when(hostZone), { label: 'Who', value: `${row.visitorName} (${row.visitorEmail})` }],
            button: { label: 'Open Bookings', url: bookingsUrl },
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
          rows: [
            { label: 'What', value: page.title },
            when(row.visitorTimeZone),
            { label: 'With', value: hostName },
            { label: 'Where', value: where },
          ],
          button: { label: 'View your booking', url: manageUrl },
          footnote: change,
          why: visitorWhy,
          ...ics('REQUEST', [visitor]),
        };
        const toCame: BookingMail[] = came.map((each) => ({
          to: each.email,
          subject: `New booking: ${page.title} with ${row.visitorName}`,
          preview: preview(hostZone),
          heading: 'A booking is now yours',
          intro: `${page.title} with ${row.visitorName} came to you through its rotation.`,
          rows: [
            when(hostZone),
            { label: 'Who', value: `${row.visitorName} (${row.visitorEmail})` },
            { label: 'Where', value: where },
            ...(note === undefined ? [] : [{ label: 'Note', value: note }]),
          ],
          button: { label: 'Open Bookings', url: bookingsUrl },
          why: hostWhy,
        }));
        const toLeft: BookingMail[] = left.map((each) => ({
          to: each.email,
          subject: `Reassigned: ${page.title} with ${row.visitorName}`,
          preview: preview(hostZone),
          heading: 'A booking moved to someone else',
          intro: `${page.title} with ${row.visitorName} is now with ${hostName}. It’s off your calendar.`,
          rows: [when(hostZone), { label: 'Who', value: `${row.visitorName} (${row.visitorEmail})` }],
          button: { label: 'Open Bookings', url: bookingsUrl },
          why: `You got this email because you hosted ${page.title}.`,
        }));
        return { messages: [toVisitor, ...toCame, ...toLeft], invited: [] };
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
              rows: [{ label: 'What', value: page.title }, when(row.visitorTimeZone), { label: 'Where', value: where }],
              button:
                row.videoUrl === null
                  ? { label: 'View your booking', url: manageUrl }
                  : { label: 'Join the call', url: row.videoUrl },
              // With Join the call as the button, the booking page's link is in the line under it.
              footnote: row.videoUrl === null ? change : `Need to change it? Your booking page: ${manageUrl}`,
              why: visitorWhy,
            },
          ],
          invited: [],
        };
      }
    }
  });
}

/** Marks guests invited once their invitation went, so a later change never invites them twice. */
export async function markInvited(scope: EngineScope, bookingId: string, emails: readonly string[]): Promise<void> {
  if (emails.length === 0) return;
  await inWorkspace(scope, (tx) =>
    tx
      .update(bookings)
      .set({
        answers: sql`jsonb_set(${bookings.answers}, '{invited}', coalesce(${bookings.answers}->'invited', '[]'::jsonb) || ${JSON.stringify(emails)}::jsonb)`,
      })
      .where(eq(bookings.id, bookingId)),
  );
}
