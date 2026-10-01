// AC-9: Lucide only, through the registry, sized and toned from tokens, and
// hidden from screen readers unless it has a label. AC-12: variants are data
// attributes declared once in the module.
import tokens from '@crm/tokens/tokens.json' with { type: 'json' };
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HUES } from '../../hue.ts';
import { Icon, type IconProps } from './Icon.tsx';
import { icons } from './icons.ts';

/** The attributes of the first `tag` element in the markup. */
function attributesOf(markup: string, tag: string): Record<string, string> {
  const open = new RegExp(`<${tag}\\b([^>]*)>`).exec(markup);
  if (!open) throw new Error(`No <${tag}> in ${markup}`);
  const attributes: Record<string, string> = {};
  for (const [, name, value] of (open[1] ?? '').matchAll(/([\w:-]+)="([^"]*)"/g)) {
    if (name !== undefined) attributes[name] = value ?? '';
  }
  return attributes;
}

function render(props: IconProps): string {
  return renderToStaticMarkup(<Icon {...props} />);
}

describe('Icon', () => {
  it('draws a decorative 16px icon by default, hidden from screen readers', () => {
    const markup = render({ name: 'building' });
    expect(markup.startsWith('<svg')).toBe(true);
    const svg = attributesOf(markup, 'svg');
    expect(svg['aria-hidden']).toBe('true');
    expect(svg.focusable).toBe('false');
    expect(svg.role).toBeUndefined();
    expect(svg['data-size']).toBe('md');
    expect(svg['data-tone']).toBe('inherit');
  });

  it('reads as an image with its label when it is the only content of a control', () => {
    const svg = attributesOf(render({ name: 'circle-question-mark', label: 'Help' }), 'svg');
    expect(svg.role).toBe('img');
    expect(svg['aria-label']).toBe('Help');
    expect(svg['aria-hidden']).toBeUndefined();
  });

  it('treats an empty label as no label', () => {
    expect(attributesOf(render({ name: 'tag', label: '' }), 'svg')['aria-hidden']).toBe('true');
  });

  it.each(['md', 'sm', 'xs'] as const)('passes size %s to its data attribute', (size) => {
    expect(attributesOf(render({ name: 'globe', size }), 'svg')['data-size']).toBe(size);
  });

  it.each(['inherit', 'muted', 'ai'] as const)('passes tone %s to its data attribute', (tone) => {
    expect(attributesOf(render({ name: 'sparkles', tone }), 'svg')['data-tone']).toBe(tone);
  });

  it('sets the icon on its hue tile, as a small icon, with the label on the tile', () => {
    const markup = render({ name: 'users', tile: 'green', label: 'People' });
    expect(markup.startsWith('<span')).toBe(true);
    const tile = attributesOf(markup, 'span');
    expect(tile['data-hue']).toBe('green');
    expect(tile.role).toBe('img');
    expect(tile['aria-label']).toBe('People');
    const svg = attributesOf(markup, 'svg');
    expect(svg['aria-hidden']).toBe('true');
    expect(svg.focusable).toBe('false');
    expect(svg['data-size']).toBe('sm');
  });

  it('hides a tile without a label', () => {
    expect(attributesOf(render({ name: 'building', tile: 'blue' }), 'span')['aria-hidden']).toBe('true');
  });

  it('refuses names outside the registry, and size or tone with a tile, at type check', () => {
    // @ts-expect-error: not a registered icon.
    const unknown: IconProps = { name: 'nope' };
    // @ts-expect-error: a tile always holds an sm icon.
    const sizedTile: IconProps = { name: 'users', tile: 'green', size: 'md' };
    // @ts-expect-error: a tile takes the hue's colour.
    const tonedTile: IconProps = { name: 'users', tile: 'green', tone: 'ai' };
    expect([unknown, sizedTile, tonedTile]).toHaveLength(3);
  });
});

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
