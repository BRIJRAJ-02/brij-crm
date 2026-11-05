// An audio intro's response (spec 0068, AC-6808): the whole file, a byte range Safari's player asks for, and every
// range it can't serve refused with 416; a part is never left in an edge's cache for the next visitor.
import { describe, expect, it } from 'vitest';
import { audioResponse } from './link-page-pictures.ts';

const STORED = { type: 'audio/mpeg', bytes: Uint8Array.from({ length: 10 }, (_, at) => at) };
const PUBLIC = 'public, max-age=3600, s-maxage=86400';

async function bytesOf(response: Response): Promise<number[]> {
  return [...new Uint8Array(await response.arrayBuffer())];
}

describe('audioResponse', () => {
  it('answers the whole recording with no range, a malformed one, or several', async () => {
    for (const range of [undefined, 'bytes=0-1,4-5', 'items=0-1', 'bytes=a-b']) {
      const response = audioResponse(STORED, PUBLIC, range);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe(PUBLIC);
      expect(response.headers.get('accept-ranges')).toBe('bytes');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(await bytesOf(response)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    }
  });

  it('answers a range, a suffix and an open end as 206, kept private', async () => {
    const first = audioResponse(STORED, PUBLIC, 'bytes=0-1');
    expect(first.status).toBe(206);
    expect(first.headers.get('content-range')).toBe('bytes 0-1/10');
    expect(first.headers.get('cache-control')).toBe('private, max-age=300');
    expect(await bytesOf(first)).toEqual([0, 1]);
    expect(await bytesOf(audioResponse(STORED, PUBLIC, 'bytes=-3'))).toEqual([7, 8, 9]);
    expect(await bytesOf(audioResponse(STORED, PUBLIC, 'bytes=8-'))).toEqual([8, 9]);
    // An end past the file is the file's end.
    expect(audioResponse(STORED, PUBLIC, 'bytes=5-999').headers.get('content-range')).toBe('bytes 5-9/10');
  });

  it('refuses what it can’t serve with 416', () => {
    for (const range of ['bytes=-', 'bytes=-0', 'bytes=5-3', 'bytes=10-', `bytes=${'9'.repeat(30)}-`]) {
      const response = audioResponse(STORED, PUBLIC, range);
      expect(response.status).toBe(416);
      expect(response.headers.get('content-range')).toBe('bytes */10');
      expect(response.headers.get('cache-control')).toBe('private, max-age=300');
    }
  });
});
