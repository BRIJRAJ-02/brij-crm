import { describe, expect, it } from 'vitest';
import { arraySource } from '../lib/list-source.ts';
import { CREATE_ROW_KEY, createRowFor, createRowText, isCreateRow, withCreateRow } from './create-row.ts';

interface Item {
  readonly id: string;
  readonly name: string;
}

const items = (...names: string[]) =>
  arraySource<Item>(
    names.map((name, index) => ({ id: String(index), name })),
    (item) => item.id,
  );
const nameOf = (item: Item) => item.name;
const loading = { count: 1, getItem: () => undefined, getKey: (item: Item) => item.id };

describe('createRowFor', () => {
  it('offers the typed name when no result has it, ignoring case and spaces', () => {
    expect(createRowFor(items('Acme Ltd'), '  Acme ', nameOf, {})).toEqual({ createRow: true, label: 'Acme' });
    expect(createRowFor(items('Acme'), 'ACME', nameOf, {})).toBeUndefined();
  });

  it('offers nothing for a blank search, while the search is out, or without an offer', () => {
    expect(createRowFor(items(), '  ', nameOf, {})).toBeUndefined();
    expect(createRowFor(loading, 'Acme', nameOf, {})).toBeUndefined();
    expect(createRowFor(items(), 'Acme', nameOf, undefined)).toBeUndefined();
    expect(createRowFor(undefined, 'Acme', nameOf, {})).toBeUndefined();
  });

  it('offers the form row whatever is typed, even a name that exists', () => {
    expect(createRowFor(items('Acme'), 'acme', nameOf, { formNoun: 'deal' })).toEqual({
      createRow: true,
      label: 'acme',
      formNoun: 'deal',
    });
    expect(createRowFor(items(), '', nameOf, { formNoun: 'deal' })?.label).toBe('');
  });
});

describe('withCreateRow', () => {
  it('puts the row last, under its own key', () => {
    const row = { createRow: true as const, label: 'Acme' };
    const source = withCreateRow(items('Globex'), row);
    expect(source.count).toBe(2);
    const last = source.getItem(1);
    expect(last !== undefined && isCreateRow(last)).toBe(true);
    expect(last === undefined ? undefined : source.getKey(last)).toBe(CREATE_ROW_KEY);
    const first = source.getItem(0);
    expect(first === undefined ? undefined : source.getKey(first)).toBe('0');
  });

  it('changes nothing without a row', () => {
    expect(withCreateRow(items('Globex'), undefined).count).toBe(1);
  });

  it('reads as the select’s Create does, or names the form', () => {
    expect(createRowText({ createRow: true, label: 'Acme' })).toBe('Create "Acme"');
    expect(createRowText({ createRow: true, label: '', formNoun: 'deal' })).toBe('Create deal…');
  });
});
