// The token reader: every value comes from tokens.json by name, and nothing
// an email can't draw (an alpha colour, an unknown name) gets through.
import tokens from '@crm/tokens/tokens.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';
import { emailStylesheet, paint, ROLE_NAMES, TYPE, wordFontStack } from './theme.ts';
import { colorToken, fontStack, pixels, radiusToken, spaceToken, typeToken } from './tokens.ts';

/** tokens.json's own value for a colour in a theme. */
function raw(name: string, scheme: 'light' | 'dark'): string {
  const token = tokens.color.tokens.find((candidate) => candidate.name === name);
  if (token === undefined || typeof token.value === 'string') throw new Error(`No themed token ${name}.`);
  return (token.value as Record<string, string>)[scheme] ?? '';
}

describe('the token reader', () => {
  it('reads each theme’s colour from tokens.json', () => {
    for (const name of ['text', 'surface-raised', 'accent', 'link', 'text-tertiary']) {
      expect(colorToken(name, 'light')).toBe(raw(name, 'light').toLowerCase());
      expect(colorToken(name, 'dark')).toBe(raw(name, 'dark').toLowerCase());
    }
  });

  it('refuses a translucent colour, which Outlook can’t draw, and a name tokens.json doesn’t have', () => {
    expect(() => colorToken('focus-ring', 'light')).toThrow(/opaque hex/);
    expect(() => colorToken('no-such-colour', 'light')).toThrow(/No colour token/);
    expect(() => spaceToken('space-7')).toThrow(/No spacing token/);
  });

  it('reads spaces, radii and type styles as tokens.json writes them', () => {
    expect(spaceToken('space-16')).toBe('16px');
    expect(radiusToken('radius-xl')).toBe('12px');
    const body = typeToken('body');
    expect(body.fontFamily).toBe(fontStack('sans'));
    expect(pixels(body.fontSize)).toBeGreaterThanOrEqual(13);
    expect(typeToken('heading').letterSpacing).toBe('-0.01em');
  });

  it('gives every role an opaque colour in both themes, light inline and dark in the stylesheet', () => {
    const sheet = emailStylesheet();
    for (const role of ROLE_NAMES) {
      for (const value of Object.values(paint(role, 'light'))) expect(value).toMatch(/^#[0-9a-f]{6}$/);
      for (const value of Object.values(paint(role, 'dark'))) {
        expect(value).toMatch(/^#[0-9a-f]{6}$/);
        expect(sheet).toContain(value);
      }
    }
  });

  it('starts Outlook’s font stacks at a family Windows has, from the tokens’ own stacks', () => {
    expect(wordFontStack('sans')).toBe('"Segoe UI", sans-serif');
    expect(wordFontStack('mono').split(', ')).not.toContain('"JetBrains Mono"');
    expect(TYPE.code.fontFamily).toBe(fontStack('mono'));
  });
});
