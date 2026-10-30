// The brand kit's contract (spec 0060, AC-3, AC-22): a colour is a six digit hex and nothing else, and every path a
// page links to is built only from checked parts.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_THEME,
  lookImagePath,
  lookStylesheetPath,
  PageTheme,
  PAGE_THEME_PRESETS,
} from './booking/page-theme.ts';
import { SaveProfileAccentInput } from './profile.ts';
import { brandLogoPath, brandStylesheetPath, BrandHex, SaveBrandInput } from './workspace-brand.ts';

const base = { workspace: 'acme', mutationId: '00000000-0000-4000-8000-000000000000' };

describe('BrandHex', () => {
  it('takes a six digit hex in any case and keeps it lowercase', () => {
    expect(BrandHex.parse('#1F5FD6')).toBe('#1f5fd6');
  });

  it.each(['#12345g', 'red', '#123456;}', '#1234567', '#fff', '', ' #123456'])('refuses %j', (bad) => {
    const parsed = BrandHex.safeParse(bad);
    expect(parsed.success).toBe(false);
    // The refusal never repeats what was typed.
    if (!parsed.success && bad !== '') expect(JSON.stringify(parsed.error.issues)).not.toContain(bad.slice(1));
  });
});

describe('SaveBrandInput and SaveProfileAccentInput', () => {
  it.each([SaveBrandInput, SaveProfileAccentInput])(
    'take a pair, clear with null, and refuse a dark alone',
    (schema) => {
      expect(schema.safeParse({ ...base, accent: '#1f5fd6', accentDark: null }).success).toBe(true);
      expect(schema.safeParse({ ...base, accent: null, accentDark: null }).success).toBe(true);
      expect(schema.safeParse({ ...base, accent: null, accentDark: '#1f5fd6' }).success).toBe(false);
      expect(schema.safeParse({ ...base, accent: '#123456;}', accentDark: null }).success).toBe(false);
    },
  );
});

describe('the paths a page links to', () => {
  it('are built only from a checked key or handle and version', () => {
    expect(brandStylesheetPath('booking', 'AbCdEfGhIjKlMnOp', 'abcdef012345')).toBe(
      '/api/public/booking/AbCdEfGhIjKlMnOp/brand.css?v=abcdef012345',
    );
    expect(brandLogoPath('forms', 'AbCdEfGhIjKlMnOp', 'abcdef012345')).toBe(
      '/api/public/forms/AbCdEfGhIjKlMnOp/logo?v=abcdef012345',
    );
    expect(lookStylesheetPath('ada', 'abcdef012345')).toBe('/api/public/handles/ada/look.css?v=abcdef012345');
    expect(lookImagePath('ada', 'cover', 'abcdef012345')).toBe('/api/public/profiles/ada/cover?v=abcdef012345');
    expect(brandStylesheetPath('booking', '../../x', 'abcdef012345')).toBeUndefined();
    expect(lookStylesheetPath('ada', '"><x')).toBeUndefined();
    expect(lookImagePath('../ada', 'ground', 'abcdef012345')).toBeUndefined();
  });
});

describe('the widened look (spec 0060, AC-8, AC-17)', () => {
  it('has fourteen presets, each a whole look', () => {
    expect(PAGE_THEME_PRESETS).toHaveLength(14);
    for (const preset of PAGE_THEME_PRESETS) expect(PageTheme.safeParse(preset.theme).success).toBe(true);
  });

  it('draws what every old look drew: the new keys default to the centred, circle, plain page', () => {
    expect(DEFAULT_PAGE_THEME).toMatchObject({ header: 'centred', avatar: 'circle' });
    for (const id of ['plain', 'paper', 'bold', 'ink', 'quiet']) {
      const preset = PAGE_THEME_PRESETS.find((each) => each.id === id);
      expect(preset?.theme).toMatchObject({ header: 'centred', avatar: 'circle' });
      expect(['plain', 'paper', 'tint', 'ink']).toContain(preset?.theme.ground);
    }
  });

  it('refuses a look missing a new key, or carrying one it does not know', () => {
    const { header: _header, ...six } = DEFAULT_PAGE_THEME;
    expect(PageTheme.safeParse(six).success).toBe(false);
    expect(PageTheme.safeParse({ ...DEFAULT_PAGE_THEME, colour: '#ff0000' }).success).toBe(false);
  });
});
