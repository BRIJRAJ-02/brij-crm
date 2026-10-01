// The icon registry names every icon as Lucide does, and HUES matches the tag
// tokens. The Icon atom's own behaviour is checked by its stories.
import tokens from '@crm/tokens/tokens.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';
import { HUES } from '../../hue.ts';
import { icons } from './icons.ts';

describe('the icon registry', () => {
  it('names every icon exactly as Lucide 1.49 does', () => {
    for (const [name, glyph] of Object.entries(icons)) {
      const pascal = name.replace(/(^|-)([a-z0-9])/g, (_match, _dash: string, letter: string) => letter.toUpperCase());
      expect(glyph.displayName, name).toBe(pascal);
    }
  });

  it('has an icon for every attribute type the artifact lists, plus AI', () => {
    for (const name of [
      'globe',
      'tag',
      'calendar',
      'circle-dollar-sign',
      'users',
      'building',
      'user',
      'star',
      'map-pin',
      'phone',
      'at-sign',
      'hash',
      'sparkles',
    ]) {
      expect(Object.keys(icons)).toContain(name);
    }
  });
});

describe('Hue', () => {
  it('lists exactly the hues tokens.json has tag tokens for', () => {
    const tagHues = tokens.color.tokens.flatMap((token) => /^tag-(.+)-bg$/.exec(token.name)?.[1] ?? []);
    expect([...HUES]).toEqual(tagHues);
  });
});
