// The connect leg's return address (spec 0028, AC-721): the choices go out and
// come back, anything malformed is dropped, and the address is tidied after.
import { describe, expect, it } from 'vitest';
import { readReturn, returnPath, tidiedAddress } from './visitor.ts';

const KEY = 'abcdefghijklmnop';

describe('the return address', () => {
  it('carries the length, the day and the zone there and back', () => {
    const path = returnPath(KEY, { duration: 45, day: '2026-11-02', zone: 'America/New_York' });
    expect(path).toBe(`/b/${KEY}?d=45&day=2026-11-02&tz=America%2FNew_York`);
    const back = new URL(`https://app.test${path}&calendar=connected`);
    expect(readReturn(back)).toEqual({
      chosen: { duration: 45, day: '2026-11-02', zone: 'America/New_York' },
      result: 'connected',
    });
    expect(returnPath(KEY, {})).toBe(`/b/${KEY}`);
  });

  it('drops anything malformed, and an unknown result', () => {
    const back = new URL(`https://app.test/b/${KEY}?d=abc&day=tomorrow&tz=%3Cscript%3E&calendar=yes`);
    expect(readReturn(back)).toEqual({ chosen: {} });
  });

  it('tidies the address after, keeping anything else', () => {
    expect(tidiedAddress(new URL(`https://app.test/b/${KEY}?d=30&calendar=denied&p=x`))).toBe(`/b/${KEY}?p=x`);
    expect(tidiedAddress(new URL(`https://app.test/b/${KEY}`))).toBeUndefined();
  });
});
