// A booking's emails on the shared layout: core's words kept as they are, the
// one button on the app's origin or (a reminder's) the meeting's call, and
// the footer's reason and tag.
import { describe, expect, it } from 'vitest';
import { renderBookingEmail } from '../index.ts';
import { bookingDocument, type BookingWords } from './booking.ts';

const ORIGIN = 'https://app.example.com';

const WORDS: BookingWords = {
  subject: 'Booked: Intro call with Ada Host',
  preview: 'Monday 2 November 2026, 9:00 AM to 9:30 AM (Europe/London)',
  heading: 'You’re booked',
  intro: 'Ada Host has been told. Here are the details.',
  rows: [
    { label: 'What', value: 'Intro call' },
    { label: 'When', value: 'Monday 2 November 2026, 9:00 AM to 9:30 AM (Europe/London)' },
  ],
  button: { label: 'View your booking', url: `${ORIGIN}/b/intro/manage?t=token` },
  footnote: 'Need to change it? Move it to another time or cancel it from your booking page.',
  why: 'You got this email because this address was used to book Intro call with Ada Host.',
};

describe('a booking email', () => {
  it('keeps core’s words in order: intro, rows, the button, the quiet line', () => {
    expect(bookingDocument(WORDS, ORIGIN)).toEqual({
      subject: WORDS.subject,
      preheader: WORDS.preview,
      heading: WORDS.heading,
      blocks: [
        { type: 'paragraph', text: WORDS.intro },
        { type: 'rows', layout: 'compact', rows: WORDS.rows },
        { type: 'button', label: 'View your booking', url: `${ORIGIN}/b/intro/manage?t=token` },
        { type: 'note', text: WORDS.footnote },
      ],
      why: WORDS.why,
      masthead: true,
    });
  });

  // The redesigned booking email (bookings redesign, 10 November 2026): the time large with its zone under it, a
  // hairline, the facts, the one button, then the quiet links, and the footer inside the card.
  const REDESIGNED: BookingWords = {
    subject: 'Booked: Intro call with Ada Host',
    preview: 'Monday, 2 November 2026, 09:00 to 09:30, London time (GMT)',
    heading: 'You’re booked with Ada Host',
    intro: '',
    when: { line: 'Monday, 2 November 2026, 09:00 to 09:30', zone: 'London time (GMT)' },
    rows: [
      { label: 'What', value: 'Intro call, 30 min' },
      { label: 'Where', value: 'Google Meet' },
    ],
    button: { label: 'Join Google Meet', url: 'https://meet.google.com/abc-defg-hij' },
    calendarUrl: `${ORIGIN}/api/public/booking/manage/token/ics`,
    change: { url: `${ORIGIN}/b/intro/manage?t=token` },
    why: 'You got this email because this address was used to book Intro call with Ada Host.',
    reply: 'Reply to reach Ada Host',
  };

  it('draws the time, a hairline, the facts, the call, then Add to calendar and Need a change', () => {
    const document = bookingDocument(REDESIGNED, ORIGIN);
    expect(document.blocks).toEqual([
      { type: 'when', line: 'Monday, 2 November 2026, 09:00 to 09:30', zone: 'London time (GMT)' },
      { type: 'rule' },
      { type: 'rows', layout: 'compact', rows: REDESIGNED.rows },
      { type: 'callButton', label: 'Join Google Meet', url: 'https://meet.google.com/abc-defg-hij' },
      {
        type: 'links',
        lead: 'Add to calendar:',
        links: [{ label: 'Calendar file (.ics)', url: `${ORIGIN}/api/public/booking/manage/token/ics` }],
      },
      {
        type: 'links',
        lead: 'Need a change?',
        links: [
          { label: 'Reschedule', url: `${ORIGIN}/b/intro/manage?t=token` },
          { label: 'Cancel', url: `${ORIGIN}/b/intro/manage?t=token` },
        ],
      },
    ]);
    expect(document.reply).toBe('Reply to reach Ada Host');
  });

  it('heads the card with the Timefix logo in each theme, and keeps the footer inside the card', async () => {
    const email = await renderBookingEmail(REDESIGNED, { appOrigin: ORIGIN, medium: 'email_booking' });
    expect(email.html).toContain(`src="${ORIGIN}/brand/email/timefix-logo-light.png"`);
    expect(email.html).toContain(`src="${ORIGIN}/brand/email/timefix-logo-dark.png"`);
    expect(email.html).toContain('.tf-mast-dark { display: block !important;');
    // Not the muted footer wordmark: the masthead is the one logo.
    expect(email.html).not.toContain('timefix-wordmark-light.png');
    expect(email.html).toContain('Reply to reach Ada Host');
    expect(email.html).toContain('Powered by Timefix');
    expect(email.text).toBe(
      [
        'You’re booked with Ada Host',
        '',
        'Monday, 2 November 2026, 09:00 to 09:30',
        'London time (GMT)',
        '',
        'What: Intro call, 30 min',
        'Where: Google Meet',
        '',
        'Join Google Meet: https://meet.google.com/abc-defg-hij',
        '',
        `Add to calendar: ${ORIGIN}/api/public/booking/manage/token/ics`,
        '',
        `Need a change? Reschedule or cancel: ${ORIGIN}/b/intro/manage?t=token`,
        '',
        'Reply to reach Ada Host',
        'Powered by Timefix: https://www.timefix.com/?utm_source=timefix&utm_medium=email_booking&utm_campaign=powered_by&utm_content=footer_logo',
        REDESIGNED.why,
      ].join('\n'),
    );
  });

  it('strikes a time that no longer stands, and sets a reason apart as a quote', async () => {
    const words: BookingWords = {
      ...REDESIGNED,
      when: { line: 'Monday, 2 November 2026, 09:00 to 09:30', zone: 'London time (GMT)', struck: true },
      quote: '“Something came up.”',
      button: { label: 'Book another time', url: `${ORIGIN}/ada/intro` },
    };
    const email = await renderBookingEmail(words, { appOrigin: ORIGIN, medium: 'email_booking' });
    expect(email.html).toContain('text-decoration:line-through');
    expect(email.html).toContain('“Something came up.”');
    expect(email.text).toContain('Monday, 2 November 2026, 09:00 to 09:30 (cancelled)');
  });

  it('refuses a quiet link off our origins, as it would a button', async () => {
    await expect(
      renderBookingEmail(
        { ...REDESIGNED, calendarUrl: 'https://calendar.google.com/calendar/render?action=TEMPLATE' },
        { appOrigin: ORIGIN, medium: 'email_booking' },
      ),
    ).rejects.toThrow('An email link must be an address on the app origin.');
    await expect(
      renderBookingEmail(
        { ...REDESIGNED, change: { url: 'https://evil.example/b/intro/manage' } },
        { appOrigin: ORIGIN, medium: 'email_booking' },
      ),
    ).rejects.toThrow('An email link must be an address on the app origin.');
  });

  it('draws it with the design system, light and dark, in HTML and plain text', async () => {
    const email = await renderBookingEmail(WORDS, { appOrigin: ORIGIN, medium: 'email_booking' });
    expect(email.subject).toBe(WORDS.subject);
    expect(email.html).toContain('You’re booked');
    expect(email.html).toContain(`href="${ORIGIN}/b/intro/manage?t=token"`);
    expect(email.html).toContain('@media (prefers-color-scheme: dark)');
    expect(email.text).toContain('View your booking: https://app.example.com/b/intro/manage?t=token');
    expect(email.text).toContain('utm_medium=email_booking');
    expect(email.text).toContain(WORDS.why);
  });

  it('draws a reminder’s Join the call as the call button, tagged as a reminder', async () => {
    const words = { ...WORDS, button: { label: 'Join the call', url: 'https://meet.google.com/abc-defg-hij' } };
    expect(bookingDocument(words, ORIGIN).blocks).toContainEqual({
      type: 'callButton',
      label: 'Join the call',
      url: 'https://meet.google.com/abc-defg-hij',
    });
    const email = await renderBookingEmail(words, { appOrigin: ORIGIN, medium: 'email_reminder' });
    expect(email.html).toContain('href="https://meet.google.com/abc-defg-hij"');
    expect(email.text).toContain('Join the call: https://meet.google.com/abc-defg-hij');
    expect(email.text).toContain('utm_medium=email_reminder');
  });

  it('refuses a call link that isn’t https, and leaves out what isn’t there', async () => {
    await expect(
      renderBookingEmail(
        { ...WORDS, button: { label: 'Join the call', url: 'javascript:alert(1)' } },
        { appOrigin: ORIGIN, medium: 'email_reminder' },
      ),
    ).rejects.toThrow('A call link must be an https address.');
    const bare: BookingWords = { ...WORDS, rows: [] };
    delete (bare as { button?: unknown }).button;
    delete (bare as { footnote?: unknown }).footnote;
    expect(bookingDocument(bare, ORIGIN).blocks).toEqual([{ type: 'paragraph', text: WORDS.intro }]);
  });

  it('names a round robin booking’s host beside their initials, after the intro (spec 0029)', async () => {
    const words = { ...WORDS, host: { label: 'Your host', name: 'Sam Lee' } };
    expect(bookingDocument(words, ORIGIN).blocks[1]).toEqual({ type: 'person', label: 'Your host', name: 'Sam Lee' });
    const email = await renderBookingEmail(words, { appOrigin: ORIGIN, medium: 'email_booking' });
    expect(email.html).toContain('>SL<');
    expect(email.html).toContain('Sam Lee');
    expect(email.html).toContain('tf-avatar');
    expect(email.text).toContain('Your host: Sam Lee');
  });
});

describe('booking pages served from their own origin (BOOKING_PUBLIC_ORIGIN)', () => {
  // `mail.ts` builds the manage button and Book again on the public origin while the email is drawn against
  // the app's. Where those differ and the document is not told, the button is not recognised as ours and is
  // drawn as the meeting's video call button instead: "View your booking" styled and labelled as join the
  // call, with no error anywhere. Found 3 November 2026, after the same mismatch had already made the forms
  // resume email impossible to send.
  const PUBLIC = 'https://book.example.com';
  const onPublic: BookingWords = {
    ...WORDS,
    button: { label: 'View your booking', url: `${PUBLIC}/b/intro/manage?t=token` },
  };

  it('sends, with the button on the public origin', async () => {
    const { html, text } = await renderBookingEmail(onPublic, {
      appOrigin: ORIGIN,
      medium: 'email_booking',
      publicOrigin: PUBLIC,
    });
    expect(html).toContain(`${PUBLIC}/b/intro/manage?t=token`);
    expect(text).toContain(`${PUBLIC}/b/intro/manage?t=token`);
  });

  it('draws it as a real button, not the video call one it was silently becoming', () => {
    const told = bookingDocument(onPublic, ORIGIN, [PUBLIC]);
    expect(told.blocks).toContainEqual({
      type: 'button',
      label: 'View your booking',
      url: `${PUBLIC}/b/intro/manage?t=token`,
    });
    // Not told, the same words give a call button: this is the defect itself, held here so it cannot come back.
    const untold = bookingDocument(onPublic, ORIGIN);
    expect(untold.blocks).toContainEqual({
      type: 'callButton',
      label: 'View your booking',
      url: `${PUBLIC}/b/intro/manage?t=token`,
    });
  });

  it('still keeps a link off every origin of ours out of the buttons the layout trusts', () => {
    const elsewhere: BookingWords = {
      ...WORDS,
      button: { label: 'Join the call', url: 'https://meet.example.com/abc' },
    };
    const drawn = bookingDocument(elsewhere, ORIGIN, [PUBLIC]);
    // A video call really is off our origins, so it stays the call button, which is what that type is for.
    expect(drawn.blocks).toContainEqual({
      type: 'callButton',
      label: 'Join the call',
      url: 'https://meet.example.com/abc',
    });
  });
});
