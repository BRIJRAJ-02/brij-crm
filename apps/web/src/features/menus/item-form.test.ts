// The item sheet's rules: one way of being priced, an allergen at one level, and nothing typed lost on the way.
import type { MenuDraft, MenuItem } from '@crm/data';
import { describe, expect, it } from 'vitest';
import {
  dietNotes,
  findsAllergen,
  hasChanged,
  itemFields,
  itemForm,
  itemProblems,
  NO_SPICE,
  placeChoices,
  withContains,
  withPriceKind,
} from './item-form.ts';

const item = (extra: Partial<MenuItem> = {}): MenuItem => ({
  id: 'i1',
  name: 'Bream',
  diet: [],
  allergens: [],
  featured: false,
  soldOut: false,
  sizes: [],
  groupIds: [],
  ...extra,
});
const keys = () => {
  let at = 0;
  return () => `k${String((at += 1))}`;
};

describe('the item form', () => {
  it('opens on what guests are shown: sizes over a price over a price text', () => {
    const size = { id: 's1', name: 'Half', priceMinor: 900 };
    expect(itemForm(item({ sizes: [size], priceMinor: 500 }), undefined, 'USD').priceKind).toBe('sizes');
    expect(itemForm(item({ priceMinor: 500, priceNote: 'Market price' }), undefined, 'USD').priceKind).toBe('price');
    expect(itemForm(item({ priceNote: 'Market price' }), undefined, 'USD').priceKind).toBe('text');
    expect(itemForm(undefined, 'Soup', 'USD')).toMatchObject({ name: 'Soup', priceKind: 'price', isAvailable: true });
  });

  it('saves only the price kind chosen', () => {
    const form = { ...itemForm(undefined, 'Soup', 'USD'), price: '9.50', priceText: 'Market price' };
    expect(itemFields(form, 'USD')).toMatchObject({ priceMinor: 950, sizes: [] });
    expect(itemFields(form, 'USD')).not.toHaveProperty('priceNote');
    const asText = itemFields({ ...form, priceKind: 'text' }, 'USD');
    expect(asText).toMatchObject({ priceMinor: null, priceNote: 'Market price', sizes: [] });
    const asSizes = withPriceKind(form, 'sizes', keys());
    expect(asSizes.sizes[0]?.price).toBe('9.50');
    expect(
      itemFields({ ...asSizes, sizes: asSizes.sizes.map((row) => ({ ...row, name: 'Bowl' })).slice(0, 1) }, 'USD'),
    ).toMatchObject({ priceMinor: null, sizes: [{ name: 'Bowl', priceMinor: 950 }] });
  });

  it('keeps what was typed when the kind changes, both ways', () => {
    const newKey = keys();
    const form = { ...itemForm(undefined, 'Soup', 'USD'), price: '9.50' };
    const sizes = withPriceKind(form, 'sizes', newKey);
    expect(sizes.sizes.map((row) => row.price)).toEqual(['9.50', '']);
    expect(withPriceKind({ ...sizes, price: '' }, 'price', newKey).price).toBe('9.50');
    // Rows already typed stay when coming back to sizes.
    const named = { ...sizes, sizes: sizes.sizes.map((row) => ({ ...row, name: 'Bowl' })) };
    expect(withPriceKind(withPriceKind(named, 'text', newKey), 'sizes', newKey).sizes).toEqual(named.sizes);
  });

  it('leaves out an untouched size row, and refuses a half filled one', () => {
    const form = withPriceKind(itemForm(undefined, 'Soup', 'USD'), 'sizes', keys());
    expect(itemProblems(form, 'USD')).toEqual({});
    expect(itemFields(form, 'USD').sizes).toEqual([]);
    const half = { ...form, sizes: form.sizes.map((row, at) => (at === 0 ? { ...row, name: 'Bowl' } : row)) };
    expect(Object.keys(itemProblems(half, 'USD'))).toEqual([`size-${half.sizes[0]?.key ?? ''}-price`]);
  });

  it('checks only what is saved: a price typed under another kind refuses nothing', () => {
    const form = { ...itemForm(undefined, 'Soup', 'USD'), price: 'abc' };
    expect(itemProblems(form, 'USD')).toHaveProperty('price');
    expect(itemProblems({ ...form, priceKind: 'text' }, 'USD')).toEqual({});
    expect(itemProblems({ ...form, name: ' ', priceKind: 'text' }, 'USD')).toHaveProperty('name');
  });

  it('moves a contained allergen out of may contain, so it is never both', () => {
    const form = { ...itemForm(undefined, 'Soup', 'USD'), may: ['milk', 'soya'] };
    const next = withContains(form, ['milk']);
    expect(next.may).toEqual(['soya']);
    expect(itemFields(next, 'USD').allergens).toEqual([
      { code: 'milk', level: 'contains' },
      { code: 'soya', level: 'may' },
    ]);
  });

  it('holds one spice level, saved among the marks', () => {
    const form = itemForm(item({ diet: ['vegan', 'spicy_2'] }), undefined, 'USD');
    expect(form).toMatchObject({ diet: ['vegan'], spice: 'spicy_2' });
    expect(itemFields(form, 'USD').diet).toEqual(['vegan', 'spicy_2']);
    expect(itemFields({ ...form, spice: NO_SPICE }, 'USD').diet).toEqual(['vegan']);
  });

  it('counts a change only when saving would change something', () => {
    const was = itemForm(
      item({
        priceMinor: 900,
        priceNote: 'Old note',
        allergens: [
          { code: 'soya', level: 'contains' },
          { code: 'celery', level: 'contains' },
        ],
      }),
      undefined,
      'USD',
    );
    expect(hasChanged(was, was)).toBe(false);
    // Looking at another kind, then coming back, changes nothing.
    const looked = withPriceKind(withPriceKind(was, 'sizes', keys()), 'price', keys());
    expect(hasChanged(looked, was)).toBe(false);
    expect(hasChanged({ ...was, priceKind: 'text' }, was)).toBe(true);
    expect(hasChanged({ ...was, featured: true }, was)).toBe(true);
    expect(hasChanged({ ...was, description: '  ' }, was)).toBe(false);
  });

  it('warns of a mark the allergens contradict or leave unsaid', () => {
    const form = {
      ...itemForm(undefined, 'Soup', 'USD'),
      diet: ['vegan', 'gluten_free'],
      contains: ['milk'],
      may: ['gluten'],
    };
    expect(dietNotes(form)).toEqual([
      'Marked Vegan, but contains milk.',
      'Marked Gluten free, but may contain gluten.',
    ]);
    expect(dietNotes({ ...form, diet: ['contains_nuts'] })).toHaveLength(1);
    expect(dietNotes({ ...form, diet: ['contains_nuts'], contains: ['nuts'] })).toEqual([]);
  });

  it('finds an allergen by an everyday word', () => {
    expect(findsAllergen({ id: 'milk', label: 'Milk' }, 'dairy')).toBe(true);
    expect(findsAllergen({ id: 'peanuts', label: 'Peanuts' }, 'NUT')).toBe(true);
    expect(findsAllergen({ id: 'eggs', label: 'Eggs' }, 'dairy')).toBe(false);
  });

  it('lists where a new item can go, sub sections after their section', () => {
    const section = (id: string, position: number, parentId?: string) =>
      ({
        id,
        menuId: 'm1',
        name: id,
        layout: 'list',
        position,
        itemIds: [],
        ...(parentId === undefined ? {} : { parentId }),
      }) as MenuDraft['sections'][number];
    const menus = [{ id: 'm1', name: 'Dinner', position: 0 }] as MenuDraft['menus'];
    const sections = [section('Mains', 1), section('Grill', 0, 'Mains'), section('Starters', 0)];
    expect(placeChoices({ menus, sections }).map((each) => each.label)).toEqual(['Starters', 'Mains', 'Mains · Grill']);
  });
});
