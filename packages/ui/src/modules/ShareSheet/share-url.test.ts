// ShareSheet's gate (spec 0073, AC-7318): every scheme that could run script is refused before anything is drawn,
// copied, shared or encoded; a web address passes as given.
import { describe, expect, it } from 'vitest';
import { shareableUrl } from './share-url.ts';

describe('shareableUrl', () => {
  it('passes a web address as given', () => {
    expect(shareableUrl('https://timefix.com/priya/discovery-call')).toBe('https://timefix.com/priya/discovery-call');
    expect(shareableUrl('http://localhost:5173/f/k3x9')).toBe('http://localhost:5173/f/k3x9');
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'DATA:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
    'VBScript:msgbox(1)',
  ])('refuses %s', (url) => {
    expect(shareableUrl(url)).toBeUndefined();
  });

  it('refuses what means nothing on another device: a path, a protocol relative link, mail, a phone, a bare word', () => {
    for (const url of ['/f/k3x9', '//evil.example/x', 'mailto:ada@example.com', 'tel:+441234', 'timefix.com', '']) {
      expect(shareableUrl(url)).toBeUndefined();
    }
  });
});
