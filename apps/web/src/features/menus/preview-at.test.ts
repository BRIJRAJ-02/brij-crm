// The editor's Preview at (spec 0065, AC-6520, after checklabs' `?at=` preview): read and written as `sat-11:00`, and
// read as the next such moment on the place's own clock.
import { describe, expect, it } from 'vitest';
import { formatPreviewAt, parsePreviewAt, previewInstant } from './preview-at.ts';

describe('Preview at', () => {
  it('reads and writes `?at=`, and refuses anything else', () => {
    expect(parsePreviewAt('sat-11:00')).toEqual({ day: 'sat', time: '11:00' });
    expect(formatPreviewAt({ day: 'sun', time: '19:30' })).toBe('sun-19:30');
    expect(parsePreviewAt('sat-11:15')).toBeUndefined();
    expect(parsePreviewAt('funday-11:00')).toBeUndefined();
    expect(parsePreviewAt(42)).toBeUndefined();
  });

  it('is the next such day at that time on the place’s clock', () => {
    // Wednesday 4 November 2026, 09:00 UTC. Saturday 11:00 in London (GMT) is 7 November, 11:00 UTC.
    const now = new Date('2026-11-04T09:00:00Z');
    expect(previewInstant({ day: 'sat', time: '11:00' }, 'Europe/London', now)?.toISOString()).toBe(
      '2026-11-07T11:00:00.000Z',
    );
    // Today counts: Wednesday 20:00 in Tokyo is 11:00 UTC the same day.
    expect(previewInstant({ day: 'wed', time: '20:00' }, 'Asia/Tokyo', now)?.toISOString()).toBe(
      '2026-11-04T11:00:00.000Z',
    );
  });
});
