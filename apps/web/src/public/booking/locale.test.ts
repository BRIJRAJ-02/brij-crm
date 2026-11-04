import { describe, expect, it } from 'vitest';
import { pageLocale } from './locale.ts';

describe('pageLocale', () => {
  it('keeps an English visitor’s own locale', () => {
    expect(pageLocale('en-GB')).toBe('en-GB');
    expect(pageLocale('en-IN')).toBe('en-IN');
  });

  it('formats in English for another language’s region, so the page reads in one language', () => {
    expect(pageLocale('ja-JP')).toBe('en-JP');
    expect(pageLocale('de-DE')).toBe('en-DE');
    const month = new Intl.DateTimeFormat(pageLocale('ja-JP'), { month: 'long', year: 'numeric' }).format(
      new Date(Date.UTC(2026, 10, 5, 12)),
    );
    expect(month).toBe('November 2026');
    expect(
      new Intl.DateTimeFormat(pageLocale('ja-JP'), { day: 'numeric' }).format(new Date(Date.UTC(2026, 10, 5, 12))),
    ).toBe('5');
  });

  it('falls back to English when there is nothing to read', () => {
    expect(pageLocale(undefined)).toBe('en-US');
    expect(pageLocale('')).toBe('en-US');
    expect(pageLocale('not a locale!')).toBe('en-US');
  });
});
