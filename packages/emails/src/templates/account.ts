// A member's account emails: a calendar that stopped syncing (spec 0024,
// AC-619 and AC-620, and its one reminder, spec 0037), a colleague asking
// them to reconnect it (spec 0037, AC-1309), a booking cancelled because its host deleted the
// calendar event (spec 0025; the guest gets no email from Timefix), and a
// sign in from a new device (spec 0033, AC-897), whose only link opens the
// account's security page and changes nothing.
import type {
  BookingCalendarRemovedEmail,
  CalendarDisconnectedEmail,
  CalendarReconnectAskedEmail,
  SignInAlertEmail,
} from '@crm/contracts/emails';
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

/**
 * A member's calendar stopped syncing (spec 0024, AC-619 and AC-620; spec 0037, AC-1310): withdrawn access
 * (`expired`) or 6 hours of failures (`failed`). One email when the episode starts, and one reminder 7 days later if
 * it is still broken, never more: the subject says what it costs, people booking them while they are busy.
 */
export const calendarDisconnected: Template<CalendarDisconnectedEmail> = (params, context) => {
  const calendar = CALENDAR_NAMES[params.provider];
  const provider = PROVIDER_NAMES[params.provider];
  const expired = params.reason === 'expired';
  const reminder = params.reminder === true;
  const title = reminder ? `Your ${calendar} still isn’t syncing` : `Your ${calendar} stopped syncing`;
  const cause = expired
    ? `${provider} no longer lets Timefix read ${params.accountEmail}.`
    : `Timefix hasn’t been able to sync ${params.accountEmail} for 6 hours.`;
  return {
    subject: title,
    preheader: reminder
      ? 'It stopped a week ago, so people may still book you when you’re busy.'
      : `People may book you when you’re busy until you reconnect ${params.accountEmail}.`,
    eyebrow: workspaceOf(context),
    heading: title,
    blocks: [
      {
        type: 'paragraph',
        text: reminder
          ? `${cause} It stopped a week ago and is still broken, so your booking pages can’t see when you’re busy and people may book you over other meetings.`
          : `${cause} Until you reconnect it, your booking pages can’t see when you’re busy, so people may book you when you’re busy.`,
      },
      { type: 'button', label: 'Reconnect calendar', url: context.link(params.settingsPath) },
      {
        type: 'note',
        text: expired
          ? `Reconnecting takes a minute: sign in to ${provider} again and allow access.`
          : 'If it starts working again by itself, there’s nothing to do.',
      },
    ],
    why: reminder
      ? 'You got this reminder because this calendar is still broken a week on. It’s the last one Timefix sends about it.'
      : `You got this email because you connected this calendar to Timefix in ${workspaceOf(context)}.`,
  };
};

/**
 * A colleague asked the member to reconnect their calendar (spec 0037, AC-1309): who asked, and the way to Settings.
 * Never which account or calendar: that is the member's own to see there.
 */
export const calendarReconnectAsked: Template<CalendarReconnectAskedEmail> = (params, context) => {
  const subject = `${params.actorName} asked you to reconnect your calendar`;
  return {
    subject,
    preheader: 'Until you do, people may book you when you’re busy.',
    eyebrow: workspaceOf(context),
    heading: subject,
    blocks: [
      {
        type: 'paragraph',
        text: `${params.actorName} asked you to reconnect your calendar in ${workspaceOf(context)}. Timefix can’t read some or all of your calendars right now, so people may book you when you’re busy.`,
      },
      { type: 'button', label: 'Reconnect calendar', url: context.link(params.settingsPath) },
      { type: 'note', text: 'Settings shows which calendar needs you. Reconnecting takes a minute.' },
    ],
    why: `You got this email because ${params.actorName} can see your scheduling in ${workspaceOf(context)}.`,
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
        text: 'If this was you, there’s nothing to do. If it wasn’t, go to Account › Sign in and devices to sign that device out and turn on two factor.',
      },
      { type: 'button', label: 'Open Sign in and devices', url: context.link(params.securityPath) },
    ],
    why: 'You got this email because a new device signed in to the Timefix account for this address.',
  };
};
