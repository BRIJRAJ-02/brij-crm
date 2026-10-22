// The booking page's slot reads: one per chunk, and a failed one waits for Try again.
import { describe, expect, it } from 'vitest';
import { needsRead, pageEnded } from './reads.ts';

const key = 'Asia/Kolkata|30|0';

describe('needsRead', () => {
  it('reads a chunk not yet loaded, and not one already loaded', () => {
    const read = { key, loaded: new Map([[0, []]]), failed: false };
    expect(needsRead(read, key, 0)).toBe(false);
    expect(needsRead(read, key, 1)).toBe(true);
  });

  it('never asks again on its own after a failed read', () => {
    const failed = { key, loaded: new Map(), failed: true };
    expect(needsRead(failed, key, 0)).toBe(false);
  });

  it('reads again after Try again, a new zone or a new length', () => {
    const failed = { key, loaded: new Map(), failed: true };
    expect(needsRead(failed, 'Asia/Kolkata|30|1', 0)).toBe(true);
    expect(needsRead(failed, 'UTC|30|0', 0)).toBe(true);
  });
});

describe('pageEnded', () => {
  it('reads a page deleted or paused since it loaded as its own state', () => {
    expect(pageEnded('NOT_FOUND')).toBe('gone');
    expect(pageEnded('BOOKING_CLOSED')).toBe('closed');
  });

  it('leaves any other refusal, or none, as a failed read', () => {
    expect(pageEnded('RATE_LIMITED')).toBeUndefined();
    expect(pageEnded('INPUT_INVALID')).toBeUndefined();
    expect(pageEnded(undefined)).toBeUndefined();
  });
});
