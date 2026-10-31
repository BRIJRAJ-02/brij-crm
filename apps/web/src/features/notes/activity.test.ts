import { describe, expect, it } from 'vitest';
import {
  activityFace,
  durationChoices,
  durationWords,
  instantOf,
  isTooFarAhead,
  nowWhen,
  outcomeTag,
  parseMinutes,
  timeItems,
  whenOf,
} from './activity.ts';

describe('a logged duration in words', () => {
  it('words minutes, whole hours and hours with minutes', () => {
    expect(durationWords(15)).toBe('15 min');
    expect(durationWords(60)).toBe('1 h');
    expect(durationWords(90)).toBe('1 h 30 min');
    expect(durationWords(1440)).toBe('24 h');
  });

  it('reads a custom length only as a whole number of minutes from 1 to 1,440', () => {
    expect(parseMinutes(' 45 ')).toBe(45);
    expect(parseMinutes('1440')).toBe(1440);
    for (const bad of ['', '0', '1441', '4.5', '-3', 'abc', '12345']) expect(parseMinutes(bad)).toBeUndefined();
  });

  it('offers the three chips, and the entry’s own length when it is another one', () => {
    expect(durationChoices(undefined).map((choice) => choice.id)).toEqual(['15', '30', '60']);
    expect(durationChoices(30).map((choice) => choice.id)).toEqual(['15', '30', '60']);
    expect(durationChoices(45).map((choice) => choice.label)).toEqual(['15 min', '30 min', '45 min', '1 h']);
  });
});

describe('an outcome as a tag', () => {
  it('words and colours each outcome', () => {
    expect(outcomeTag('connected')).toEqual({ label: 'Connected', hue: 'green' });
    expect(outcomeTag('no_show')).toEqual({ label: 'No show', hue: 'red' });
  });

  it('shows nothing for none, or for one this app does not know', () => {
    expect(outcomeTag(undefined)).toBeUndefined();
    expect(outcomeTag('somersault')).toBeUndefined();
  });
});

describe('when something happened', () => {
  const zone = 'Asia/Kolkata';

  it('reads an instant as the zone’s day and minute, and back', () => {
    // 09:30 UTC is 15:00 in Kolkata (UTC+5:30).
    const when = whenOf('2026-10-08T09:30:00.000Z', zone);
    expect(when).toEqual({ day: '2026-10-08', minute: 15 * 60 });
    expect(instantOf(when, zone)).toBe('2026-10-08T09:30:00.000Z');
  });

  it('crosses midnight in the zone, not in UTC', () => {
    // 20:00 UTC on the 8th is 01:30 on the 9th in Kolkata.
    expect(whenOf('2026-10-08T20:00:00.000Z', zone)).toEqual({ day: '2026-10-09', minute: 90 });
  });

  it('opens on now rounded down to five minutes', () => {
    const now = Date.parse('2026-10-08T09:37:42.000Z');
    expect(nowWhen(now, 'UTC')).toEqual({ day: '2026-10-08', minute: 9 * 60 + 35 });
  });

  it('refuses a time more than a day ahead, and allows one up to a day ahead', () => {
    const now = Date.parse('2026-10-08T09:00:00.000Z');
    expect(isTooFarAhead({ day: '2026-10-09', minute: 8 * 60 }, 'UTC', now)).toBe(false);
    expect(isTooFarAhead({ day: '2026-10-09', minute: 10 * 60 }, 'UTC', now)).toBe(true);
    expect(isTooFarAhead({ day: '2026-10-01', minute: 0 }, 'UTC', now)).toBe(false);
  });
});

describe('the time list', () => {
  it('lists the day in five minute steps in the language’s clock', () => {
    const items = timeItems('en-US');
    expect(items).toHaveLength(288);
    // Newer ICU writes a narrow no break space before AM and PM.
    const plain = (label: string | undefined) => label?.replace(/\s/g, ' ');
    expect(items[0]?.id).toBe('0');
    expect(plain(items[0]?.label)).toBe('12:00 AM');
    expect(plain(items.find((item) => item.id === '845')?.label)).toBe('2:05 PM');
  });

  it('adds an entry’s own minute when it is off the steps, in order', () => {
    const items = timeItems('en-GB', 14 * 60 + 7);
    const at = items.findIndex((item) => item.id === String(14 * 60 + 7));
    expect(items[at]?.label).toBe('14:07');
    expect(items[at - 1]?.id).toBe(String(14 * 60 + 5));
    expect(items[at + 1]?.id).toBe(String(14 * 60 + 10));
  });
});

describe('a note’s face', () => {
  it('has none for a plain note', () => {
    expect(activityFace({ kind: 'note' })).toBeUndefined();
  });

  it('words a call’s duration and outcome', () => {
    expect(activityFace({ kind: 'call', durationMinutes: 30, outcome: 'connected' })).toEqual({
      kind: 'call',
      duration: '30 min',
      outcome: { label: 'Connected', hue: 'green' },
    });
    expect(activityFace({ kind: 'meeting' })).toEqual({ kind: 'meeting' });
  });
});
