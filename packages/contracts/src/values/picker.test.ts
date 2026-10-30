import { describe, expect, it } from 'vitest';
import { STARTER_STAGES, starterOptionsFor, typeFor } from './picker.ts';

describe('typeFor', () => {
  it('guesses an attribute type from its name', () => {
    expect(typeFor('Email')).toBe('email');
    expect(typeFor('Phone')).toBe('phone');
    expect(typeFor('Website')).toBe('url');
    expect(typeFor('Price')).toBe('currency');
    expect(typeFor('Due date')).toBe('date');
    expect(typeFor('Nickname')).toBe('text');
  });

  it('types a stage as status, an owner as member and a priority as select', () => {
    expect(typeFor('Stage')).toBe('status');
    expect(typeFor('Status')).toBe('status');
    expect(typeFor('Owner')).toBe('actor_reference');
    expect(typeFor('Priority')).toBe('select');
    // A word only inside a longer name keeps its own match: an owner's email is an email.
    expect(typeFor('Owner email')).toBe('email');
  });
});

describe('starterOptionsFor', () => {
  it('starts a status with its stages and a priority with three levels', () => {
    expect(starterOptionsFor('Stage', 'status')).toBe(STARTER_STAGES);
    expect(starterOptionsFor('Priority', 'select').map((option) => option.label)).toEqual(['Low', 'Medium', 'High']);
    expect(starterOptionsFor('Category', 'select')).toEqual([]);
    expect(starterOptionsFor('Name', 'text')).toEqual([]);
  });
});
