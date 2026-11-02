// A next times chip's hand off (spec 0061, AC-6110): what the booking page takes from `?at=` and `&len=`, and all
// the shapes it refuses without ever saying so, since both arrive in a public address anybody can write.
import { describe, expect, it } from 'vitest';
import { openingOf, readAt } from './at-param.ts';

const now = Date.parse('2026-11-03T10:00:00.000Z');
const at = (query: string) => new URL(`https://timefix.com/ada/intro${query}`);

describe('readAt', () => {
  it('reads a time and a length, in one spelling', () => {
    expect(readAt(at('?at=2026-11-04T09:00:00.000Z&len=30'), now)).toEqual({
      start: '2026-11-04T09:00:00.000Z',
      startMs: Date.parse('2026-11-04T09:00:00.000Z'),
      duration: 30,
    });
    // An offset spelling of the same instant reads as the same time.
    expect(readAt(at('?at=2026-11-04T10:00:00%2B01:00'), now)?.start).toBe('2026-11-04T09:00:00.000Z');
  });

  it('ignores a time that is no instant, or nowhere near now', () => {
    expect(readAt(at(''), now)).toBeUndefined();
    expect(readAt(at('?at='), now)).toBeUndefined();
    expect(readAt(at('?at=soon'), now)).toBeUndefined();
    expect(readAt(at(`?at=${'9'.repeat(70)}`), now)).toBeUndefined();
    expect(readAt(at('?at=1998-01-01T09:00:00.000Z'), now)).toBeUndefined();
    expect(readAt(at('?at=2099-01-01T09:00:00.000Z'), now)).toBeUndefined();
  });

  it('ignores a length that is not a whole number of minutes in range, and keeps the time', () => {
    const start = '?at=2026-11-04T09:00:00.000Z';
    for (const len of ['0', '-30', '30.5', 'thirty', '1441', '']) {
      expect(readAt(at(`${start}&len=${len}`), now)?.duration).toBeUndefined();
      expect(readAt(at(`${start}&len=${len}`), now)?.start).toBe('2026-11-04T09:00:00.000Z');
    }
  });
});

describe('openingOf', () => {
  const dayOf = () => '2026-11-04';

  it('opens on the chip’s day, at its length, with its time', () => {
    expect(openingOf(at('?at=2026-11-04T09:00:00.000Z&len=45'), now, dayOf)).toEqual({
      chosen: { day: '2026-11-04', duration: 45 },
      at: '2026-11-04T09:00:00.000Z',
    });
  });

  it('is the return from Google, untouched, for an address with no usable at', () => {
    expect(openingOf(at('?d=30&day=2026-11-10&tz=UTC&calendar=connected'), now, dayOf)).toEqual({
      chosen: { duration: 30, day: '2026-11-10', zone: 'UTC' },
      result: 'connected',
    });
    expect(openingOf(at('?at=nonsense'), now, dayOf)).toEqual({ chosen: {} });
  });
});
