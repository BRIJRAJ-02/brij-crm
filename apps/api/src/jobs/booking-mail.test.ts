// The booking email task (spec 0025, milestone 2) with a fake mailer, never
// real mail: a queued confirmation drawn and sent with its calendar file, the
// guests marked invited, a failed send thrown for Graphile's retry, mail off
// logged and dropped, and a payload that isn't ours ignored. Against the test
// database.
import { createBookingPage, createWorkspace, newId, NO_CALENDAR } from '@crm/core';
import { bookPublicSlot, enterBookingPage } from '@crm/core/public';
import { systemScope } from '@crm/core/system';
import { testScope } from '@crm/core/testing';
import { createDatabase, type Database } from '@crm/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { bookingEmail } from '../mail/booking.ts';
import type { Mailer, MailMessage } from '../mail/mailer.ts';
import { runBookingMail } from './booking-mail.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-booking-mail-task-tests' });
});
afterAll(async () => {
  await db.close();
});

const LINK_KEY = Buffer.alloc(32, 5);
const NOW = new Date('2026-11-01T00:00:00.000Z');

/** A mailer that keeps what it was given, failing the first `fail` sends. */
function fakeMailer(fail = 0): Mailer & { readonly sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  let left = fail;
  return {
    transport: 'mailpit',
    sent,
    send(message) {
      if (left > 0) {
        left -= 1;
        return Promise.reject(new Error('refused'));
      }
      sent.push(message);
      return Promise.resolve();
    },
  };
}

const quiet = { info: () => undefined, warn: () => undefined };

async function booked() {
  const created = await createWorkspace(db, {
    name: 'Mail task',
    slug: `mail-task-${newId().slice(-12)}`,
    firstMember: { name: 'Ada Host', email: 'ada@example.com' },
  });
  const host = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const page = await createBookingPage(host, { id: newId(), title: 'Intro call', timeZone: 'UTC' }, NOW);
  const result = await bookPublicSlot(
    await enterBookingPage({ db }, page.publicKey),
    { calendar: NO_CALENDAR, now: () => NOW, linkKey: LINK_KEY },
    {
      idempotencyKey: newId(),
      start: '2026-11-02T09:00:00.000Z',
      duration: 30,
      name: 'Grace Hopper',
      email: 'grace@navy.example',
      timeZone: 'UTC',
      guests: ['ann@navy.example'],
    },
  );
  return { workspaceId: created.workspaceId, ...result };
}

const depsWith = (mailer: Mailer | undefined) => ({
  systemScope: (workspaceId: string) => systemScope(db, workspaceId),
  mailer,
  links: {
    appOrigin: 'https://app.example',
    linkKey: LINK_KEY,
    organizerEmail: 'bookings@app.example',
    now: () => NOW,
  },
  log: quiet,
});

describe('the booking email task', () => {
  it('sends the confirmation with its calendar file, and invites each guest once', async () => {
    const b = await booked();
    const mailer = fakeMailer();
    await runBookingMail(depsWith(mailer), { workspaceId: b.workspaceId, bookingId: b.bookingId, kind: 'confirmed' });
    expect(mailer.sent.map((mail) => mail.to)).toEqual(['grace@navy.example', 'ada@example.com', 'ann@navy.example']);
    const [visitor] = mailer.sent;
    expect(visitor?.html).toContain(`/manage?t=${b.manageToken}`);
    expect(visitor?.html).toMatch(/<html[^>]* lang="en"/);
    expect(visitor?.text).toContain('View your booking: https://app.example/b/');
    expect(visitor?.attachments?.[0]).toMatchObject({
      filename: 'invite.ics',
      contentType: 'text/calendar; charset=utf-8; method=REQUEST',
    });
    // The guest is marked invited: a guests run sends nothing more.
    const again = fakeMailer();
    await runBookingMail(depsWith(again), { workspaceId: b.workspaceId, bookingId: b.bookingId, kind: 'guests' });
    expect(again.sent).toEqual([]);
  });

  it('throws plainly only when every send fails, so Graphile tries again', async () => {
    const b = await booked();
    const one = fakeMailer(1);
    await runBookingMail(depsWith(one), { workspaceId: b.workspaceId, bookingId: b.bookingId, kind: 'confirmed' });
    expect(one.sent).toHaveLength(2);
    await expect(
      runBookingMail(depsWith(fakeMailer(3)), {
        workspaceId: b.workspaceId,
        bookingId: b.bookingId,
        kind: 'confirmed',
      }),
    ).rejects.toThrow('A booking email failed to send; the worker log has its booking id.');
  });

  it('drops the email when mail is off, and ignores a payload that isn’t ours', async () => {
    const b = await booked();
    const logged: string[] = [];
    const log = { info: (message: string) => logged.push(message), warn: (message: string) => logged.push(message) };
    await runBookingMail(
      { ...depsWith(undefined), log },
      { workspaceId: b.workspaceId, bookingId: b.bookingId, kind: 'confirmed' },
    );
    await runBookingMail({ ...depsWith(fakeMailer()), log }, { bookingId: b.bookingId, kind: 'confirmed', extra: 1 });
    expect(logged).toEqual(['booking.mail.skipped', 'booking.mail.payload_invalid']);
  });
});

describe('the booking email', () => {
  const mail = {
    to: 'grace@navy.example',
    subject: 'Booked: Intro call with Ada Host',
    preview: 'Monday',
    heading: 'You’re booked',
    intro: 'Ada Host has been told.',
    rows: [{ label: 'When', value: 'Monday 2 November 2026, 9:00 AM to 9:30 AM (UTC)' }],
    button: { label: 'View your booking', url: 'https://app.example/b/x/manage?t=y' },
    footnote: 'Need to change it?',
    why: 'You got this email because this address was used to book Intro call with Ada Host.',
  };

  it('draws the rows, the button and the footnote on the shared layout, with a plain text twin', async () => {
    const message = await bookingEmail(mail, { appOrigin: 'https://app.example', medium: 'email_booking' });
    expect(message.subject).toBe('Booked: Intro call with Ada Host');
    expect(message.html).toContain('Monday 2 November 2026, 9:00 AM to 9:30 AM (UTC)');
    expect(message.html).toContain('href="https://app.example/b/x/manage?t=y"');
    expect(message.html).toContain('prefers-color-scheme: dark');
    expect(message.attachments).toBeUndefined();
    expect(message.text).toBe(
      [
        'You’re booked',
        '',
        'Ada Host has been told.',
        '',
        'When: Monday 2 November 2026, 9:00 AM to 9:30 AM (UTC)',
        '',
        'View your booking: https://app.example/b/x/manage?t=y',
        '',
        'Need to change it?',
        '',
        'Powered by Timefix: https://www.timefix.com/?utm_source=timefix&utm_medium=email_booking&utm_campaign=powered_by&utm_content=footer_logo',
        'You got this email because this address was used to book Intro call with Ada Host.',
      ].join('\n'),
    );
  });

  it('draws a reminder’s Join the call as the call button, tagged as a reminder, with the calendar file kept', async () => {
    const message = await bookingEmail(
      {
        ...mail,
        button: { label: 'Join the call', url: 'https://meet.google.com/abc-defg-hij' },
        ics: { filename: 'invite.ics', content: 'BEGIN:VCALENDAR', method: 'REQUEST' },
      },
      { appOrigin: 'https://app.example', medium: 'email_reminder' },
    );
    expect(message.html).toContain('href="https://meet.google.com/abc-defg-hij"');
    expect(message.text).toContain('utm_medium=email_reminder');
    expect(message.attachments).toEqual([
      {
        filename: 'invite.ics',
        content: 'BEGIN:VCALENDAR',
        contentType: 'text/calendar; charset=utf-8; method=REQUEST',
      },
    ]);
  });

  it('refuses a button to another site that isn’t https', async () => {
    await expect(
      bookingEmail(
        { ...mail, button: { label: 'Join the call', url: 'http://evil.example/x' } },
        { appOrigin: 'https://app.example', medium: 'email_reminder' },
      ),
    ).rejects.toThrow('A call link must be an https address.');
  });
});
