import { describe, expect, it } from 'vitest';
import { hueFor, iconFor, pluralOf, startersFor, typeFor } from './new-object-guess.ts';

describe('new object guesses', () => {
  it('pluralises a name', () => {
    expect(pluralOf('Project')).toBe('Projects');
    expect(pluralOf('Company')).toBe('Companies');
    expect(pluralOf('Day')).toBe('Days');
    expect(pluralOf('Box')).toBe('Boxes');
    expect(pluralOf('  ')).toBe('');
  });
  it('guesses an icon and a free colour', () => {
    expect(iconFor('Invoice')).toBe('receipt');
    expect(iconFor('Zebra')).toBe('box');
    expect(hueFor('Projects', ['gray', 'red', 'blue'], ['red'])).not.toBe('red');
    expect(hueFor('Projects', ['gray', 'red', 'blue'], [])).not.toBe('gray');
  });
  it('guesses an attribute type from its name', () => {
    expect(typeFor('Email')).toBe('email');
    expect(typeFor('Phone')).toBe('phone');
    expect(typeFor('Website')).toBe('url');
    expect(typeFor('Price')).toBe('currency');
    expect(typeFor('Due date')).toBe('date');
    expect(typeFor('Nickname')).toBe('text');
  });
  it('suggests starters by object', () => {
    expect(startersFor('Project').map((starter) => starter.title)).toContain('Due date');
    expect(startersFor('')).toEqual([]);
  });
});
