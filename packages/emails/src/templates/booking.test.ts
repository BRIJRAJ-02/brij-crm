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
    });
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
