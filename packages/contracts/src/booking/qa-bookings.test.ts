// The bookings QA lane's pure checks (4 November 2026, "bulletproof before release"): what a visitor may type into a
// booking (names in any script, emoji, long names, emails, guests, a number to call), what a slots read may ask for,
// and what the public shapes strip before anything leaves the server. A comment marked Fixed names a defect the QA
// lane found and the fix lane closed (see apps/web/e2e/BOOKINGS-QA.md).
import { describe, expect, it } from 'vitest';
import {
  PUBLIC_SLOTS_MAX_DAYS,
  PublicBookInput,
  PublicCancelInput,
  PublicSlot,
  PublicSlotsQuery,
  VISITOR_NAME_MAX,
} from './public.ts';

const BASE = {
  idempotencyKey: '0199f0a0-0000-7000-8000-000000000001',
  start: '2027-01-04T09:00:00.000Z',
  duration: 30,
  name: 'Grace Hopper',
  email: 'grace@navy.example',
  timeZone: 'Europe/London',
} as const;

const book = (over: Record<string, unknown>) => PublicBookInput.safeParse({ ...BASE, ...over });

describe('a visitor’s name', () => {
  it.each([
    ['Arabic, right to left', 'محمد علي'],
    ['Hebrew, right to left', 'דוד כהן'],
    ['emoji', '🌻 Ada Lovelace 👩‍💻'],
    ['accents and apostrophes', 'Zoë O’Brien-Núñez'],
    ['CJK', '山田太郎'],
    ['the longest allowed', 'a'.repeat(VISITOR_NAME_MAX)],
  ])('%s is taken as typed', (_label, name) => {
    const parsed = book({ name });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.name).toBe(name);
  });

  it('one past the longest is refused with the visitor’s message', () => {
    const parsed = book({ name: 'a'.repeat(VISITOR_NAME_MAX + 1) });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe('Keep your name to 200 characters.');
  });

  it('only spaces is refused', () => {
    expect(book({ name: '   ' }).success).toBe(false);
  });

  // Fixed (B-07): the name goes into email subjects ("… booked Intro call") and the .ics; a CR or LF reaches a mail
  // header on any SMTP path, and a NUL or other control character is never a name. Refuse [\x00-\x1F\x7F].
  it.each([
    ['a CRLF and a header', 'Eve\r\nBcc: victim@example.com'],
    ['a bare line feed', 'Eve\nSecond line'],
    ['a NUL', 'Eve\u0000'],
    ['a bell', 'Eve\u0007'],
  ])('%s in the name is refused', (_label, name) => {
    expect(book({ name }).success).toBe(false);
  });

  // Fixed (B-06): the guest invitation reads "<name> invited you to …", so a name carrying a web address turns a booking
  // into a phishing mail sent from our domain to up to 10 strangers. A person's name never needs a URL.
  it('a web address in the name is refused', () => {
    expect(book({ name: 'Your account is locked, verify at https://evil.example' }).success).toBe(false);
  });
});

describe('a visitor’s email', () => {
  it('capitals are folded to lower case', () => {
    expect(book({ email: 'GRACE@NAVY.EXAMPLE' }).data?.email).toBe('grace@navy.example');
  });

  it.each([['ada@'], ['ada@@example.com'], ['ada lovelace@example.com'], [`${'a'.repeat(250)}@example.com`]])(
    '%s is refused',
    (email) => {
      expect(book({ email }).success).toBe(false);
    },
  );

  // Fixed (B-12): `.trim()` runs after the email check in Zod 4, so a phone keyboard's trailing space (iOS adds one
  // after an autofill suggestion) is refused by an API or chat client that doesn't trim first. The page's own form
  // trims, so only other callers meet it. Fix: `z.string().trim().toLowerCase().pipe(z.email().max(254))`.
  it('an email with spaces around it is taken, trimmed', () => {
    const parsed = book({ email: '  Grace@Navy.example ' });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.email).toBe('grace@navy.example');
  });

  it('a guest email with spaces around it is taken, trimmed', () => {
    const parsed = book({ guests: [' Ada@Example.com '] });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.guests).toEqual(['ada@example.com']);
  });

  it('11 guests are refused, 10 taken', () => {
    const ten = Array.from({ length: 10 }, (_, n) => `g${String(n)}@example.com`);
    expect(book({ guests: ten }).success).toBe(true);
    expect(book({ guests: [...ten, 'g10@example.com'] }).success).toBe(false);
  });
});

describe('a number to call (a phone page)', () => {
  it('a real number is taken', () => {
    expect(book({ phone: '+44 20 7946 0958' }).success).toBe(true);
  });

  // Fixed (B-08): a phone page books with any text up to 40 characters as "the number to call", so the host learns at
  // the meeting time that "call me" or "asdf" is not a number. Forms already refuse these (contracts forms check.ts,
  // "a phone of letters", "a phone too short"); a booking page's number should pass the same check.
  it.each([['call me'], ['asdf'], ['12'], ['<script>']])('%s is refused as a number to call', (phone) => {
    expect(book({ phone }).success).toBe(false);
  });
});

describe('a slots read', () => {
  const query = (from: string, to: string) =>
    PublicSlotsQuery.safeParse({ from, to, tz: 'Europe/London', duration: '30' });

  it(`takes ${String(PUBLIC_SLOTS_MAX_DAYS)} days, refuses one more`, () => {
    const from = Date.parse('2027-01-01T00:00:00.000Z');
    const day = 86_400_000;
    expect(
      query(new Date(from).toISOString(), new Date(from + PUBLIC_SLOTS_MAX_DAYS * day).toISOString()).success,
    ).toBe(true);
    expect(
      query(new Date(from).toISOString(), new Date(from + (PUBLIC_SLOTS_MAX_DAYS + 1) * day).toISOString()).success,
    ).toBe(false);
  });

  it('refuses an empty or backwards range', () => {
    expect(query('2027-01-02T00:00:00.000Z', '2027-01-02T00:00:00.000Z').success).toBe(false);
    expect(query('2027-01-03T00:00:00.000Z', '2027-01-02T00:00:00.000Z').success).toBe(false);
  });

  it('refuses a zone that isn’t one', () => {
    expect(
      PublicSlotsQuery.safeParse({ from: '2027-01-01T00:00:00.000Z', to: '2027-01-02T00:00:00.000Z', tz: 'Mars/Base' })
        .success,
    ).toBe(false);
  });
});

describe('privacy: what the public shapes let out', () => {
  it('a slot carries its start and end only, whatever the server had beside it', () => {
    const parsed = PublicSlot.parse({
      start: '2027-01-04T09:00:00.000Z',
      end: '2027-01-04T09:30:00.000Z',
      title: 'Board meeting',
      attendee: 'someone@example.com',
      memberId: 'x',
    });
    expect(Object.keys(parsed).sort()).toEqual(['end', 'start']);
  });

  it('a cancel reason stops at 500 characters', () => {
    expect(PublicCancelInput.safeParse({ reason: 'a'.repeat(500) }).success).toBe(true);
    expect(PublicCancelInput.safeParse({ reason: 'a'.repeat(501) }).success).toBe(false);
  });
});

describe('the slots reads the public page sends, across a clock change', () => {
  // The page (apps/web BookingPage.tsx) reads times 62 calendar days at a time, from one local midnight to another
  // (`startOfDay(addDays(today, n * 62), zone)`), clamped below to now. The instants below are those midnights.
  const read = (from: string, to: string, tz: string) => PublicSlotsQuery.safeParse({ from, to, tz });

  it('62 calendar days with no clock change are taken', () => {
    expect(read('2026-11-04T00:00:00.000Z', '2027-01-05T00:00:00.000Z', 'Europe/London').success).toBe(true);
  });

  // Fixed (B-01): 62 calendar days that hold a clock going back are 62 days and one hour long, and PublicSlotsQuery
  // refuses anything past 62 × 24 hours. Every chunk after the first starts at a local midnight, so on a page whose
  // window is longer than 62 days, the chunk holding the end of summer time answers "Ask for a range of at most 62
  // days." and the visitor sees no times for those two months. The first chunk fails the same way for a visitor who
  // opens the page between midnight and one in the morning. Fix (contracts, `PublicSlotsQuery`): allow 62 days plus
  // the largest DST shift (two hours, Lord Howe aside), or (UI) clamp `to` to `from` + 62 × 24 hours.
  it.each([
    // London: 20 Sep 00:00 BST to 21 Nov 00:00 GMT (clocks back 25 Oct).
    [
      'London, the chunk over the end of October',
      '2026-09-19T23:00:00.000Z',
      '2026-11-21T00:00:00.000Z',
      'Europe/London',
    ],
    // New York: 25 Sep 00:00 EDT to 26 Nov 00:00 EST (clocks back 1 Nov).
    [
      'New York, the chunk over the first Sunday of November',
      '2026-09-25T04:00:00.000Z',
      '2026-11-26T05:00:00.000Z',
      'America/New_York',
    ],
    // Sydney, opened today (4 Nov 2026), its third chunk: 7 Mar 00:00 AEDT to 8 May 00:00 AEST (clocks back 4 Apr).
    [
      'Sydney, the third chunk over the first Sunday of April',
      '2027-03-06T13:00:00.000Z',
      '2027-05-07T14:00:00.000Z',
      'Australia/Sydney',
    ],
    // London, opened at 00:30 on 1 Sep: from now to 2 Nov 00:00 GMT.
    [
      'London, the first chunk opened at half past midnight',
      '2026-08-31T23:30:00.000Z',
      '2026-11-02T00:00:00.000Z',
      'Europe/London',
    ],
  ])('%s is taken', (_label, from, to, tz) => {
    expect(read(from, to, tz).success).toBe(true);
  });
});
