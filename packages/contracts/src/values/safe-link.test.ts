// The one link rule (spec 0003, AC-14; spec 0019's security review): links
// are judged as the browser would resolve them, with control characters
// refused first.
import { describe, expect, it } from 'vitest';
import { isSafeLink, safeLink } from './safe-link.ts';

describe('safeLink', () => {
  it.each([
    'https://example.com/a?b#c',
    'http://example.com',
    'mailto:ada@example.com',
    'tel:+447700900123',
    '/w/acme/objects/people',
  ])('allows %s', (href) => {
    expect(safeLink(href)).toBe(href);
    expect(isSafeLink(href)).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    ' JavaScript:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'java\rscript:alert(1)',
    'https://example.com/\nnext',
    'https:\u0000//example.com',
    'data:text/html,<b>x</b>',
    '//evil.example',
    '/\\evil.example',
    '/w\\..\\evil',
    'people/1',
    './people',
    'example',
    '',
  ])('refuses %j', (href) => {
    expect(safeLink(href)).toBeUndefined();
    expect(isSafeLink(href)).toBe(false);
  });
});
