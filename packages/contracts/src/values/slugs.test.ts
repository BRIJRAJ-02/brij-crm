import { describe, expect, it } from 'vitest';
import { freeHue, nextHue, PICKER_TYPES, STARTER_STAGES } from './picker.ts';
import { API_SLUG_PATTERN, freeApiSlug, MAX_API_SLUG, RESERVED_SLUGS, toApiSlug } from './slugs.ts';

describe('toApiSlug (spec 0012, AC-245)', () => {
  it('derives an API name from a plural name or a title', () => {
    expect(toApiSlug('Projects', 'object')).toBe('projects');
    expect(toApiSlug('Café orders', 'object')).toBe('cafe_orders');
    expect(toApiSlug('  Deal -- stage!! ', 'attribute')).toBe('deal_stage');
    expect(toApiSlug('2026 goals', 'attribute')).toBe('x_2026_goals');
  });

  it('gives the kind when nothing is left, and keeps to 63 characters', () => {
    expect(toApiSlug('!!!', 'object')).toBe('object');
    expect(toApiSlug('', 'attribute')).toBe('attribute');
    const long = toApiSlug(`${'a'.repeat(62)} b`, 'attribute');
    expect(long.length).toBeLessThanOrEqual(63);
    expect(long.endsWith('_')).toBe(false);
  });

  it('appends _object to a reserved object name, never to an attribute', () => {
    for (const reserved of RESERVED_SLUGS) expect(toApiSlug(reserved, 'object')).toBe(`${reserved}_object`);
    expect(toApiSlug('Map', 'object')).toBe('map_object');
    expect(toApiSlug('Map', 'attribute')).toBe('map');
  });

  it('always answers a well formed API name', () => {
    for (const text of ['Projects', '2026', 'Ünïcödé', '東京', 'a b c', 'Settings', '_x_']) {
      expect(toApiSlug(text, 'object')).toMatch(API_SLUG_PATTERN);
      expect(toApiSlug(text, 'attribute')).toMatch(API_SLUG_PATTERN);
    }
  });
});

describe('the type picker and new options (AC-228, AC-230, AC-236)', () => {
  it('offers exactly seventeen entries in the spec order (File joined on 27 Oct, Date and time on 31 Oct 2026)', () => {
    expect(PICKER_TYPES.map((entry) => entry.key)).toEqual([
      'text',
      'long_text',
      'number',
      'currency',
      'date',
      'timestamp',
      'checkbox',
      'select',
      'multi_select',
      'status',
      'rating',
      'email',
      'phone',
      'link',
      'location',
      'member',
      'file',
    ]);
    expect(PICKER_TYPES.filter((entry) => entry.allowsMultiple).map((entry) => entry.key)).toEqual([
      'email',
      'phone',
      'member',
    ]);
  });

  it('starts a status with three stages', () => {
    expect(STARTER_STAGES.map((stage) => [stage.label, stage.outcome, stage.hue])).toEqual([
      ['Not started', 'open', 'gray'],
      ['In progress', 'open', 'blue'],
      ['Done', 'won', 'green'],
    ]);
  });

  it('gives the next hue after the last option, cycling, and a free hue to a new object', () => {
    expect(nextHue([])).toBe('gray');
    expect(nextHue([{ hue: 'gray' }])).toBe('red');
    expect(nextHue([{ hue: 'red' }, { hue: 'purple' }])).toBe('gray');
    expect(freeHue([{ hue: 'gray' }, { hue: 'red' }])).toBe('orange');
  });
});

describe('freeApiSlug (an archived attribute keeps its API name)', () => {
  it('keeps a free name, else numbers it from 2, skipping the numbers taken', () => {
    expect(freeApiSlug('price', new Set())).toBe('price');
    expect(freeApiSlug('price', new Set(['price']))).toBe('price_2');
    expect(freeApiSlug('price', new Set(['price', 'price_2', 'price_3']))).toBe('price_4');
  });

  it('cuts a long name so the number fits within 63 characters, and stays a valid API name', () => {
    const long = 'a'.repeat(MAX_API_SLUG);
    const free = freeApiSlug(long, new Set([long]));
    expect(free).toBe(`${'a'.repeat(MAX_API_SLUG - 2)}_2`);
    expect(free).toMatch(API_SLUG_PATTERN);
  });
});
