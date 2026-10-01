// The library's pure helpers: the link and image checks (AC-14), typed numbers
// in the viewer's format (AC-5), and dates, amounts and relative times in the
// provider's language and time zone (AC-11).
import { describe, expect, it } from 'vitest';
import { parseLocaleDecimal } from './decimal.ts';
import { formatAmount, formatDate, formatDecimal, formatExactTime, formatRelative, minorUnits } from './format.ts';
import { arraySource } from './list-source.ts';
import { safeHref } from './safe-href.ts';
import { safeImageSrc } from './safe-image-src.ts';
import { initialsOf, stableHue } from './stable-hue.ts';

describe('safeHref', () => {
  it.each([
    'https://example.com/a?b#c',
    'http://example.com',
    'mailto:ada@example.com',
    'tel:+447700900123',
    '/people/1',
  ])('allows %s', (href) => {
    expect(safeHref(href)).toBe(href);
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox',
    '//evil.example',
    '/\\evil.example',
    'people/1',
    '',
    '   ',
    undefined,
  ])('refuses %s', (href) => {
    expect(safeHref(href)).toBeUndefined();
  });
});

describe('safeImageSrc', () => {
  const origin = 'https://app.example.com';

  it.each([
    '/files/a.png',
    'https://app.example.com/a.png',
    'data:image/png;base64,AAAA',
    'blob:https://app.example.com/1',
  ])('allows %s', (src) => {
    expect(safeImageSrc(src, origin)).toBe(src);
  });

  it.each(['https://cdn.other.com/a.png', '//cdn.other.com/a.png', 'data:text/html,x', 'javascript:x', undefined])(
    'refuses %s',
    (src) => {
      expect(safeImageSrc(src, origin)).toBeUndefined();
    },
  );
});

describe('parseLocaleDecimal', () => {
  it.each([
    ['1,234.5', 'en-US', '1234.5'],
    ['1.234,5', 'de-DE', '1234.5'],
    ['1 234,5', 'fr-FR', '1234.5'],
    ['1.5', 'de-DE', '1.5'],
    ['1.234', 'de-DE', '1234'],
    ['-0012,50', 'de-DE', '-12.5'],
    ['1234.5', 'de-DE', '1234.5'],
    [' 42 ', 'en-GB', '42'],
  ])('reads %s in %s as %s', (text, locale, canonical) => {
    expect(parseLocaleDecimal(text, locale)).toBe(canonical);
  });

  it.each([
    ['1.23456', 'en-US'],
    ['abc', 'en-US'],
    ['1,2,3', 'en-US'],
    ['', 'en-US'],
    ['1e5', 'en-US'],
  ])('refuses %s in %s', (text, locale) => {
    expect(parseLocaleDecimal(text, locale)).toBeUndefined();
  });
});

describe('formats', () => {
  it('formats decimals exactly, with up to 4 decimals and no float rounding', () => {
    expect(formatDecimal('1234.5678', 'en-US')).toBe('1,234.5678');
    expect(formatDecimal('999999999999999.9999', 'en-US')).toBe('999,999,999,999,999.9999');
    expect(formatDecimal('1234.5', 'de-DE')).toBe('1.234,5');
  });

  it('shows at least a currency’s minor units', () => {
    expect(minorUnits('USD')).toBe(2);
    expect(minorUnits('JPY')).toBe(0);
    expect(formatAmount('1234.5', 'USD', 'en-US')).toBe('1,234.50');
    expect(formatAmount('1234.5678', 'USD', 'en-US')).toBe('1,234.5678');
    expect(formatAmount('500', 'JPY', 'en-US')).toBe('500');
  });

  it('formats a calendar day without shifting it by any time zone', () => {
    expect(formatDate('2026-10-08', 'en-US')).toBe('Oct 8, 2026');
    expect(formatDate('2026-10-08', 'de-DE')).toBe('08.10.2026');
  });

  it('gives the exact time with its time zone', () => {
    expect(formatExactTime('2026-10-08T14:30:00.000Z', 'en-GB', 'Europe/London')).toBe('8 Oct 2026, 15:30 BST');
  });

  it('gives relative times in the largest whole unit, and the date past a week', () => {
    const now = Date.UTC(2026, 9, 8, 14, 30);
    const at = (ms: number) => new Date(now - ms).toISOString();
    expect(formatRelative(at(20_000), now, 'en-US', 'UTC')).toBe('now');
    expect(formatRelative(at(5 * 60_000), now, 'en-US', 'UTC')).toBe('5 minutes ago');
    expect(formatRelative(at(3 * 3_600_000), now, 'en-US', 'UTC')).toBe('3 hours ago');
    expect(formatRelative(at(26 * 3_600_000), now, 'en-US', 'UTC')).toBe('yesterday');
    expect(formatRelative(at(-2 * 3_600_000), now, 'en-US', 'UTC')).toBe('in 2 hours');
    expect(formatRelative(at(9 * 86_400_000), now, 'en-US', 'UTC')).toBe('Sep 29, 2026');
    expect(formatRelative(at(3 * 3_600_000), now, 'de-DE', 'UTC')).toBe('vor 3 Stunden');
  });
});

describe('avatars', () => {
  it('picks the same hue for the same id, every time', () => {
    expect(stableHue('person_1')).toBe(stableHue('person_1'));
    const hues = new Set(Array.from({ length: 60 }, (_, i) => stableHue(`id_${String(i)}`)));
    expect(hues.size).toBeGreaterThan(5);
  });

  it('takes up to two initials', () => {
    expect(initialsOf('Ada Lovelace')).toBe('AL');
    expect(initialsOf('  grace   brewster hopper ')).toBe('GH');
    expect(initialsOf('Northwind')).toBe('N');
    expect(initialsOf('')).toBe('');
  });
});

describe('arraySource', () => {
  it('serves items in memory through the ListSource shape', () => {
    const source = arraySource(['a', 'b'], (item) => item);
    expect(source.count).toBe(2);
    expect(source.getItem(1)).toBe('b');
    expect(source.getItem(2)).toBeUndefined();
  });
});
