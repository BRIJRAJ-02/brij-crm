// The record panel's place in the list beside it (spec 0074, AC-7412): its numbers read in the app's locale.
import { describe, expect, it } from 'vitest';
import { strings } from './strings.ts';

describe('strings.place', () => {
  it('formats the numbers in the locale it is given, not the runtime default', () => {
    expect(strings.place('People', 3, 1200, false, 'de-DE')).toBe('People · 3 of 1.200');
    expect(strings.place('People', 1200, 120000, true, 'en-IN')).toBe('People · 1,200 of 1,20,000+');
  });
});
