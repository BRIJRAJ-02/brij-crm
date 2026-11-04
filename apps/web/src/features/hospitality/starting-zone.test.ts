// The business card starts from the workspace's zone, or the browser's while the workspace's is still the default UTC.
import { describe, expect, it } from 'vitest';
import { startingZone } from './starting-zone.ts';

describe('the business card’s starting zone', () => {
  it('keeps a zone the workspace chose', () => {
    expect(startingZone('Europe/London', 'Asia/Kolkata')).toBe('Europe/London');
  });

  it('takes the browser’s zone over the default UTC', () => {
    expect(startingZone('UTC', 'Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(startingZone(undefined, 'Asia/Kolkata')).toBe('Asia/Kolkata');
  });

  it('falls back to UTC when nothing says otherwise', () => {
    expect(startingZone(undefined, undefined)).toBe('UTC');
  });
});
