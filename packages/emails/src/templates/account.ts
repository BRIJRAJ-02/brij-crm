// A member's account emails: a calendar that stopped syncing (spec 0024,
// AC-619 and AC-620), a booking cancelled because its host deleted the
// calendar event (spec 0025; the guest gets no email from Timefix), and a
// sign in from a new device (spec 0033, AC-897), whose only link opens the
// account's security page and changes nothing.
import type { BookingCalendarRemovedEmail, CalendarDisconnectedEmail, SignInAlertEmail } from '@crm/contracts/emails';
import { formatDay, formatMoment, formatSpan } from '../format.ts';
import { workspaceOf, type Template } from '../template.ts';

/** A provider's calendar, as people call it. */
const CALENDAR_NAMES: Readonly<Record<CalendarDisconnectedEmail['provider'], string>> = {
  google: 'Google calendar',
  microsoft: 'Outlook calendar',
};

/** The provider's own name. */
const PROVIDER_NAMES: Readonly<Record<CalendarDisconnectedEmail['provider'], string>> = {
  google: 'Google',
  microsoft: 'Microsoft',
};

/** A member's calendar stopped syncing: withdrawn access (`expired`), or 6 hours of failures (`failed`). */
export const calendarDisconnected: Template<CalendarDisconnectedEmail> = (params, context) => {
  const calendar = CALENDAR_NAMES[params.provider];
  const expired = params.reason === 'expired';
  const title = expired ? `Reconnect your ${calendar}` : `Your ${calendar} stopped syncing`;
  return {
    subject: title,
    preheader: expired
      ? `${PROVIDER_NAMES[params.provider]} stopped letting Timefix read ${params.accountEmail}.`
      : `Timefix hasn’t been able to sync ${params.accountEmail} for 6 hours.`,
    eyebrow: workspaceOf(context),
    heading: title,
    blocks: [
      {
        type: 'paragraph',
        text: expired
          ? `${PROVIDER_NAMES[params.provider]} no longer lets Timefix read ${params.accountEmail}. Until you reconnect it, your booking pages can’t see when you’re busy, and new events won’t reach Timefix.`
          : `Timefix hasn’t been able to sync ${params.accountEmail} for 6 hours. It keeps trying, but until it works, your booking pages can’t see new busy times.`,
      },
      { type: 'button', label: 'Reconnect calendar', url: context.link(params.settingsPath) },
      {
        type: 'note',
        text: expired
          ? `Reconnecting takes a minute: sign in to ${PROVIDER_NAMES[params.provider]} again and allow access.`
          : 'If it starts working again by itself, there’s nothing to do.',
      },
    ],
    why: `You got this email because you connected this calendar to Timefix in ${workspaceOf(context)}.`,
  };
};

/** A booking cancelled because its host deleted its calendar event: for the host alone. */
export const bookingCalendarRemoved: Template<BookingCalendarRemovedEmail> = (params, context) => ({
  subject: `Cancelled: ${params.title} with ${params.guestName}`,
  preheader: 'You deleted it from your calendar, so the time is free again.',
  eyebrow: workspaceOf(context),
  heading: 'Booking cancelled',
  blocks: [
    {
      type: 'paragraph',
      text: `You deleted ${params.title} with ${params.guestName} from your calendar, so Timefix cancelled the booking and freed the time.`,
    },
    {
      type: 'rows',
      layout: 'compact',
      rows: [
        { label: 'When', value: formatSpan(params.startsAt, params.endsAt, params.timeZone) },
        { label: 'Guest', value: `${params.guestName} (${params.guestEmail})` },
      ],
    },
    { type: 'button', label: 'Open bookings', url: context.link(params.bookingsPath) },
    {
      type: 'note',
      text: `Timefix didn’t email ${params.guestName} about this. Google offers to tell guests when you delete an event, so they may already know. If not, let them know yourself.`,
    },
  ],
  why: `You got this email because you host this booking in ${workspaceOf(context)}.`,
});

/** How a sign in happened, in words. */
const METHODS: Readonly<Record<SignInAlertEmail['method'], string>> = {
  code: 'Email code',
  google: 'Google',
  passkey: 'Passkey',
};

/** A sign in from a device the account hasn't used in 90 days. */
export const signInAlert: Template<SignInAlertEmail> = (params, context) => {
  const where = params.place === undefined ? '' : ` in ${params.place}`;
  return {
    subject: 'New sign in to your Timefix account',
    preheader: `${params.device}${where}, ${formatDay(params.signedInAt, params.timeZone)}.`,
    heading: 'New sign in to Timefix',
    blocks: [
      {
        type: 'paragraph',
        text: 'Your account was just signed in to from a device it hasn’t used in the last 90 days.',
      },
      {
        type: 'rows',
        layout: 'compact',
        rows: [
          { label: 'When', value: formatMoment(params.signedInAt, params.timeZone) },
          { label: 'Device', value: params.device },
          ...(params.place === undefined ? [] : [{ label: 'Where', value: `${params.place} (approximate)` }]),
          { label: 'How', value: METHODS[params.method] },
        ],
      },
      {
        type: 'note',
        text: 'If this was you, there’s nothing to do. If it wasn’t, go to Account › Security to sign that device out and turn on two factor.',
      },
      { type: 'button', label: 'Open Account › Security', url: context.link(params.securityPath) },
    ],
    why: 'You got this email because a new device signed in to the Timefix account for this address.',
  };
};
