// The bookings QA lane's abuse checks on the public booking routes (4 November 2026): the bot check and the limits a
// flood meets. Pure. A comment marked Fixed names a defect the QA lane found and the fix lane closed (see apps/web/e2e/BOOKINGS-QA.md).
import { describe, expect, it } from 'vitest';
import { BOOKING_LIMITS, botReason, MIN_FILL_MS } from './limits.ts';

const NOW = Date.parse('2027-01-04T09:00:00.000Z');

describe('the bot check on a booking', () => {
  it('a filled honeypot is a bot', () => {
    expect(botReason({ company_url: 'https://spam.example' }, NOW)).toBe('trap');
  });

  it('a valid ticket under two seconds is a bot, over it a person', () => {
    expect(botReason({}, NOW, MIN_FILL_MS - 1)).toBe('too_fast');
    expect(botReason({}, NOW, MIN_FILL_MS + 1)).toBeUndefined();
  });

  it('a page loaded a moment ago (startedAt) is a bot', () => {
    expect(botReason({ startedAt: NOW - 100 }, NOW)).toBe('too_fast');
  });

  // Fixed (B-04): with no ticket the check trusts the client's own `startedAt`, so a script sends `startedAt: 0` (or
  // leaves both out) and passes as a person who took 57 years to fill the form. Fix (API, booking.ts /book and the
  // chat turn that books): once the ticket book is set up, a missing or invalid ticket is `too_fast`; `startedAt`
  // stays only for a deploy without tickets.
  it('no ticket and startedAt 0 is not waved through', () => {
    expect(botReason({ startedAt: 0 }, NOW, undefined)).toBe('too_fast');
  });

  it('no ticket and no startedAt is not waved through', () => {
    expect(botReason({}, NOW, undefined)).toBe('too_fast');
  });
});

describe('the limits a flood of bookings meets', () => {
  it('per address, per page and per booking limits exist', () => {
    expect(BOOKING_LIMITS.booksPerAddress.max).toBeLessThanOrEqual(5);
    expect(BOOKING_LIMITS.booksPerPage.max).toBeLessThanOrEqual(50);
    expect(BOOKING_LIMITS.managePerBooking.max).toBeLessThanOrEqual(8);
  });

  // Fixed (B-02): forms have an instance ceiling (`forms:instance`) and a per email limit (5 an hour), bookings have
  // neither. Each booking sends up to 11 emails (the visitor and 10 guests) from our domain, and the per address key
  // hashes the whole IP, so each IPv6 address in one /64 is a new visitor. Fix (API, public/limits.ts and
  // booking.ts): `booksPerInstance`, `booksPerEmail` (hashed, an hour), and key IPv6 on its /64.
  it('a per instance ceiling and a per email limit exist for booking', () => {
    expect(Object.keys(BOOKING_LIMITS)).toEqual(expect.arrayContaining(['booksPerInstance', 'booksPerEmail']));
  });

  it('a daily ceiling on guest invitations per page exists', () => {
    expect(Object.keys(BOOKING_LIMITS).some((key) => /invit|guests/i.test(key))).toBe(true);
  });
});
