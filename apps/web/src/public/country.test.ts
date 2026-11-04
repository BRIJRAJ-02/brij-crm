// Where a guest form's Country and Phone start (forms fixes 2): the browser's stated region, else the workspace's
// country, else what the language implies.
import { describe, expect, it } from 'vitest';
import { formCountry, statedRegion } from './country.ts';

describe('formCountry', () => {
  it('starts at the region the browser names outright', () => {
    expect(formCountry('GB', ['en-IN', 'en'])).toBe('IN');
  });

  it('starts at the workspace’s country when the browser names no region (a bare en is not the United States)', () => {
    expect(statedRegion(['en'])).toBeUndefined();
    expect(formCountry('IN', ['en'])).toBe('IN');
  });

  it('falls back to what the language implies when the workspace says nothing', () => {
    expect(formCountry(undefined, ['fr'])).toBe('FR');
    expect(formCountry(undefined, [])).toBeUndefined();
  });
});
