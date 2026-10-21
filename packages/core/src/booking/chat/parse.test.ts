import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import {
  isChangeQuestion,
  isNo,
  isYes,
  readBareName,
  readEmail,
  readIntroducedName,
  readLength,
  readPhone,
  readSelection,
  readTime,
} from './parse.ts';

// Wednesday 21 October 2026, 10:00 in London.
const now = DateTime.fromISO('2026-10-21T10:00', { zone: 'Europe/London' });

/** A point's instant, or a window's start and end, as local ISO minutes. */
function read(text: string, at = now) {
  const ask = readTime(text, at, 60);
  if (ask === undefined) return undefined;
  return ask.kind === 'point'
    ? { at: ask.at.toFormat("yyyy-MM-dd'T'HH:mm"), implied: ask.dateImplied }
    : {
        from: ask.start.toFormat("yyyy-MM-dd'T'HH:mm"),
        to: ask.end.toFormat("yyyy-MM-dd'T'HH:mm"),
        phrase: ask.phrase,
      };
}

describe('readTime (AC-1505, AC-1506)', () => {
  it.each([
    ['tomorrow at 3pm', { at: '2026-10-22T15:00', implied: false }],
    ['3pm', { at: '2026-10-21T15:00', implied: true }],
    ['9am', { at: '2026-10-22T09:00', implied: true }],
    ['15:30', { at: '2026-10-21T15:30', implied: true }],
    ['friday at 4', { at: '2026-10-23T04:00', implied: false }],
    ['Tue 27 Oct at 3:00 PM', { at: '2026-10-27T15:00', implied: false }],
    ['Tue 27 Oct at 15:00', { at: '2026-10-27T15:00', implied: false }],
    ['oct 30th at noon', { at: '2026-10-30T12:00', implied: false }],
    ['the 25th at 4pm', { at: '2026-10-25T16:00', implied: false }],
    ['2026-11-02 10:30', { at: '2026-11-02T10:30', implied: false }],
    ['tomorrow at 3 in the afternoon', { at: '2026-10-22T15:00', implied: false }],
  ])('reads %s as a point', (text, expected) => {
    expect(read(text)).toEqual(expected);
  });

  it.each([
    ['next tuesday afternoon', '2026-10-27T12:00', '2026-10-27T17:00', 'Tuesday afternoon'],
    ['tuesday', '2026-10-27T00:00', '2026-10-28T00:00', 'Tuesday'],
    ['this afternoon', '2026-10-21T12:00', '2026-10-21T17:00', 'this afternoon'],
    ['morning', '2026-10-21T08:00', '2026-10-21T12:00', 'this morning'],
    ['evening', '2026-10-21T17:00', '2026-10-21T21:00', 'this evening'],
    ['tomorrow evening', '2026-10-22T17:00', '2026-10-22T21:00', 'tomorrow evening'],
    ['next week', '2026-10-26T00:00', '2026-11-02T00:00', 'next week'],
    ['between 2 and 4pm', '2026-10-21T14:00', '2026-10-21T16:00', 'today then'],
    ['between 2 and 4', '2026-10-21T14:00', '2026-10-21T16:00', 'today then'],
    ['thursday 1-3pm', '2026-10-22T13:00', '2026-10-22T15:00', 'tomorrow then'],
    ['25 nov', '2026-11-25T00:00', '2026-11-26T00:00', 'Wed 25 Nov'],
    ['the weekend', '2026-10-24T00:00', '2026-10-26T00:00', 'at the weekend'],
  ])('reads %s as a window', (text, from, to, phrase) => {
    expect(read(text)).toEqual({ from, to, phrase });
  });

  it('reads asap as the whole horizon', () => {
    const ask = readTime('asap please', now, 60);
    expect(ask?.kind === 'window' && ask.end.diff(ask.start, 'days').days).toBe(60);
  });

  it('puts a past date in the coming year', () => {
    expect(read('3 jan')).toMatchObject({ from: '2027-01-03T00:00' });
  });

  it('answers nothing for words with no time in them', () => {
    expect(read('hello there')).toBeUndefined();
    expect(read('30 minutes')).toBeUndefined();
    expect(read('ada@example.com')).toBeUndefined();
  });

  it('reads in the visitor’s zone, not the server’s', () => {
    const tokyo = DateTime.fromISO('2026-10-21T23:30', { zone: 'Asia/Tokyo' });
    const ask = readTime('tomorrow at 9am', tokyo, 60);
    expect(ask?.kind === 'point' && ask.at.toISO()).toBe('2026-10-22T09:00:00.000+09:00');
  });
});

describe('the details readers (AC-1513)', () => {
  it('reads an email in any sentence', () => {
    expect(readEmail('sure, it’s Ada.L@Example.com thanks')).toBe('ada.l@example.com');
    expect(readEmail('no email here')).toBeUndefined();
  });

  it('reads an introduced name and stops at the email', () => {
    expect(readIntroducedName("I'm Ada Lovelace, ada@example.com")).toBe('Ada Lovelace');
    expect(readIntroducedName('my name is Grace and my email is g@x.io')).toBe('Grace');
    expect(readIntroducedName("I'm free tomorrow")).toBeUndefined();
  });

  it('reads a bare name, never a yes or a question', () => {
    expect(readBareName('Ada Lovelace')).toBe('Ada Lovelace');
    expect(readBareName('Ada, ada@example.com')).toBe('Ada');
    expect(readBareName('José Núñez')).toBe('José Núñez');
    expect(readBareName('yes')).toBeUndefined();
    expect(readBareName('what is open')).toBeUndefined();
  });

  it('reads a phone number of 7 to 20 digits', () => {
    expect(readPhone('call me on +44 20 7946 0958')).toBe('+44 20 7946 0958');
    expect(readPhone('123')).toBeUndefined();
  });

  it('reads lengths', () => {
    expect(readLength('make it an hour')).toBe(60);
    expect(readLength('half an hour')).toBe(30);
    expect(readLength('45 minutes')).toBe(45);
    expect(readLength('tomorrow')).toBeUndefined();
  });

  it('reads picks among offers', () => {
    expect(readSelection('the second one', 6)).toBe(1);
    expect(readSelection('last', 4)).toBe(3);
    expect(readSelection('3', 2)).toBe(1);
    expect(readSelection('first', 0)).toBeUndefined();
  });

  it('tells yes, no and change questions apart', () => {
    expect(isYes('Yes, book it')).toBe(true);
    expect(isYes('no, not that one')).toBe(false);
    expect(isNo('Something later')).toBe(true);
    expect(isNo('Something else')).toBe(true);
    expect(isChangeQuestion('can I cancel later?')).toBe(true);
    expect(isChangeQuestion('reschedule to 3pm')).toBe(false);
  });
});
