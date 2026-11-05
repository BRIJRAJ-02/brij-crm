// The guest look (spec 0065, AC-6570 as amended): every preset reads at AA in its own colours, a look nobody can read
// still draws readable words and buttons, and nothing but a closed word or a whole hex passes the schema.
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './brand-colour.ts';
import { PAGE_FONTS } from './booking/page-theme.ts';
import { MenuLook, SaveMenuLookInput } from './menu.ts';
import {
  DEFAULT_MENU_LOOK,
  MENU_FONTS,
  MENU_FONT_FACES,
  MENU_PRESETS,
  menuLookColours,
  menuLookContrast,
  menuLookPalette,
  menuLookRoles,
  menuLookScheme,
  menuLookShape,
  presetLook,
  WARM_PRESET,
  type MenuLookChoice,
  type MenuLookRoles,
} from './menu-model.ts';

/** Every word and control pair a guest page draws. */
function expectReadable(roles: MenuLookRoles): void {
  for (const surface of [roles.ground, roles.card, roles.chip]) {
    expect(contrastRatio(roles.text, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(roles.quiet, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(roles.highlight, surface)).toBeGreaterThanOrEqual(4.5);
  }
  expect(contrastRatio(roles.onAccent, roles.accent)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(roles.onInk, roles.ink)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(roles.accent, roles.ground)).toBeGreaterThanOrEqual(3);
}

describe('presets', () => {
  it.each(MENU_PRESETS)('%s passes AA in its own colours, on both of a visitor’s sides', (preset) => {
    const look = presetLook(preset);
    expectReadable(menuLookRoles(look, {}, 'light'));
    expectReadable(menuLookRoles(look, {}, 'dark'));
  });

  it.each(MENU_PRESETS)('%s still passes with a brand kit accent nobody could read', (preset) => {
    for (const accent of ['#ffff00', '#000000', '#ffffff', '#808080', '#e8590c']) {
      expectReadable(menuLookRoles(presetLook(preset), { accent }, 'light'));
      expectReadable(menuLookRoles(presetLook(preset), { accent }, 'dark'));
    }
  });

  it('keeps Warm value for value with no accent', () => {
    expect(menuLookRoles(DEFAULT_MENU_LOOK, {}, 'light')).toEqual(WARM_PRESET.light);
    expect(menuLookRoles(DEFAULT_MENU_LOOK, {}, 'dark')).toEqual(WARM_PRESET.dark);
  });

  it('pins a dark or light preset, and lets Warm follow the visitor', () => {
    expect(menuLookScheme(presetLook('warm'))).toBe('follow');
    expect(menuLookScheme(presetLook('clean'))).toBe('follow');
    expect(menuLookScheme(presetLook('noir'))).toBe('dark');
    expect(menuLookScheme(presetLook('ronin'))).toBe('dark');
    expect(menuLookScheme(presetLook('night'))).toBe('dark');
    expect(menuLookScheme(presetLook('linen'))).toBe('light');
  });

  it('lets a preset that keeps its own colours ignore the brand kit', () => {
    const noir = menuLookRoles(presetLook('noir'), { accent: '#1f5fd6' }, 'dark');
    expect(noir.accent).toBe('#d4af37');
    expect(menuLookRoles(presetLook('warm'), { accent: '#1f5fd6' }, 'light').accent).not.toBe(WARM_PRESET.light.accent);
  });
});

describe('a picked palette', () => {
  const custom = (palette: NonNullable<MenuLookChoice['palette']>): MenuLookChoice => ({
    ...DEFAULT_MENU_LOOK,
    palette,
  });

  it('draws readable words on a page and words of one colour', () => {
    expectReadable(menuLookRoles(custom({ surface: '#777777', ink: '#777777' }), {}, 'light'));
    expectReadable(menuLookRoles(custom({ surface: '#ffffff', ink: '#ffffff', highlight: '#ffffff' }), {}, 'light'));
    expectReadable(menuLookRoles(custom({ surface: '#000000', ink: '#000000', highlight: '#000000' }), {}, 'light'));
  });

  it('gives any brand colour a readable button', () => {
    for (const brand of ['#ffff00', '#ffffff', '#000000', '#7f7f7f', '#dc2626', '#00ff00']) {
      for (const surface of ['#ffffff', '#000000', '#7f7f7f', '#ffff00']) {
        expectReadable(menuLookRoles(custom({ surface, brand }), {}, 'light'));
      }
    }
  });

  it('pins the page to the side its own ground reads as', () => {
    expect(menuLookScheme(custom({ surface: '#101010' }))).toBe('dark');
    expect(menuLookScheme(custom({ surface: '#fdf6e3' }))).toBe('light');
    // Only the buttons or the prices picked: Warm still follows the visitor.
    expect(menuLookScheme(custom({ brand: '#dc2626' }))).toBe('follow');
  });

  it('says what fails as picked, even though the page draws something readable', () => {
    const palette = menuLookPalette(custom({ ink: '#dddddd' }), 'light');
    const contrast = menuLookContrast(palette);
    expect(contrast.ink.passes).toBe(false);
    expect(contrast.brand.passes).toBe(true);
    expect(contrast.ink.ratio).toBeLessThan(4.5);
  });
});

describe('what can reach CSS', () => {
  it('holds every font to the brand kit’s pack and the device', () => {
    expect([...MENU_FONTS].sort()).toEqual([...PAGE_FONTS, 'device'].sort());
    for (const font of MENU_FONTS) expect(MENU_FONT_FACES[font]).toMatch(/^(var\(--font-[a-z-]+\)|ui-sans-serif, .*)$/);
  });

  it('writes only constants and whole hexes', () => {
    const look = { ...presetLook('ronin'), palette: { surface: '#102030' } };
    for (const [name, value] of [...menuLookShape(look), ...menuLookColours(look, {}, 'dark')]) {
      expect(name).toMatch(/^--menu-[a-z-]+$/);
      expect(value).not.toMatch(/[;{}<>\\]/);
    }
  });

  it.each([
    ['a colour name', { palette: { brand: 'red' } }],
    ['a short hex', { palette: { brand: '#fff' } }],
    ['an upper case hex', { palette: { brand: '#FFFFFF' } }],
    ['alpha', { palette: { brand: '#ffffff00' } }],
    ['a closing brace', { palette: { brand: '#ffffff;}body{display:none' } }],
    ['a url', { palette: { surface: 'url(https://evil.example/x.png)' } }],
    ['a var', { palette: { ink: 'var(--anything)' } }],
    ['a newline after the hex', { palette: { ink: '#ffffff\n' } }],
    ['a role of its own', { palette: { hover: '#ffffff' } }],
    ['a font not on the list', { heading: 'Comic Sans' }],
    ['a font stack', { body: 'var(--x);}' }],
    ['a preset not on the list', { preset: 'sakura' }],
    ['a raw radius', { radius: '4px' }],
    ['a key of its own', { css: 'body{display:none}' }],
    ['a cover with a path', { cover: { id: '../x', version: 'abcdefabcdef' } }],
    ['a cover with a url', { cover: { id: '0190f000-0000-7000-8000-000000000000', version: 'https://x' } }],
    [
      'a cover with a key of its own',
      { cover: { id: '0190f000-0000-7000-8000-000000000000', version: 'abcdefabcdef', href: 'x' } },
    ],
  ])('refuses %s', (_name, change) => {
    expect(MenuLook.safeParse({ ...DEFAULT_MENU_LOOK, ...change }).success).toBe(false);
  });

  it('takes every preset and a full palette', () => {
    for (const preset of MENU_PRESETS) expect(MenuLook.safeParse(presetLook(preset)).success).toBe(true);
    const palette = { surface: '#ffffff', ink: '#000000', brand: '#123456', highlight: '#abcdef' };
    expect(MenuLook.safeParse({ ...DEFAULT_MENU_LOOK, palette }).success).toBe(true);
  });

  it('checks the look on the write', () => {
    const write = {
      workspace: 'acme',
      mutationId: '0190f000-0000-7000-8000-000000000000',
      look: { ...DEFAULT_MENU_LOOK, palette: { ink: 'expression(alert(1))' } },
    };
    expect(SaveMenuLookInput.safeParse(write).success).toBe(false);
  });
});
