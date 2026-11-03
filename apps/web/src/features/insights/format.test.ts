import { describe, expect, it } from 'vitest';
import { biggestDrop, duration, insightsCsv, tilesOf, toCsv } from './format.ts';

const numbers = {
  from: '2026-10-29',
  to: '2026-11-04',
  grain: 'day' as const,
  totals: { visits: 120, finishes: 30, avgMs: 95_000 },
  previous: { visits: 100, finishes: 30, avgMs: 120_000 },
  buckets: [{ start: '2026-11-04', visits: 120, finishes: 30 }],
};

describe('the tiles (AC-6711)', () => {
  it('says each figure against the period before, the rate in points and the time in words', () => {
    const tiles = tilesOf(numbers, 'en-GB');
    expect(tiles.map((tile) => [tile.id, tile.value, tile.comparison, tile.trend])).toEqual([
      ['visits', '120', '+20 on the 7 days before', 'up'],
      ['finishes', '30', 'Same as the 7 days before', 'same'],
      ['rate', '25%', '−5 points on the period before', 'down'],
      ['time', '1m 35s', '25s faster than before', undefined],
    ]);
  });

  it('compares nothing for all time, and says when no finish was timed', () => {
    const tiles = tilesOf({ ...numbers, previous: undefined, totals: { visits: 3, finishes: 0 } }, 'en-GB');
    expect(tiles[0]?.comparison).toBeUndefined();
    expect(tiles[3]).toMatchObject({ value: '—', comparison: 'No finish timed yet' });
  });
});

describe('the biggest drop (AC-6713)', () => {
  it('names the step that loses the most people, with its share', () => {
    const funnel = {
      kind: 'booking' as const,
      steps: [
        { step: 'view', reached: 100 },
        { step: 'time', reached: 80 },
        { step: 'details', reached: 30 },
      ],
      finished: 20,
    };
    expect(biggestDrop(funnel, 'en-GB')).toBe('Most leave at Time: 63%');
  });

  it('says nothing when nobody left part way', () => {
    expect(biggestDrop({ kind: 'link', steps: [{ step: 'view', reached: 0 }], finished: 0 })).toBeUndefined();
  });
});

describe('CSV (AC-6717)', () => {
  it('quotes what must be quoted and never hands a spreadsheet a formula', () => {
    expect(toCsv(['a', 'b'], [['=HYPERLINK("x")', 'a,b']])).toBe('a,b\r\n"\'=HYPERLINK(""x"")","a,b"');
  });

  it('carries a name only where the screen shows one', () => {
    const csv = insightsCsv({ ...numbers, sources: [] }, [
      {
        id: 's1',
        at: '2026-11-04T10:00:00.000Z',
        pageKind: 'form',
        pageId: '0190a0a0-0000-7000-8000-000000000001',
        pageName: 'Enquiry',
        finished: true,
        source: 'ig',
        furthestStep: 'finish',
        person: { name: 'Asha Rao' },
      },
      {
        id: 's2',
        at: '2026-11-04T11:00:00.000Z',
        pageKind: 'form',
        pageId: '0190a0a0-0000-7000-8000-000000000001',
        pageName: 'Enquiry',
        finished: true,
        source: 'direct',
        furthestStep: 'finish',
      },
    ]);
    expect(csv).toContain('Asha Rao');
    expect(csv.split('\r\n').filter((line) => line.startsWith('2026-11-04T11'))).toEqual([
      '2026-11-04T11:00:00.000Z,Enquiry,yes,direct,,,finish,,',
    ]);
  });

  it('writes durations as people read them', () => {
    expect([duration(45_000), duration(150_000), duration(3_840_000)]).toEqual(['45s', '2m 30s', '1h 4m']);
  });
});
