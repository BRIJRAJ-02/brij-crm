import { describe, expect, it } from 'vitest';
import { nameFromText } from './name.ts';

describe('nameFromText', () => {
  it('splits a pasted full name at the first space, or last name first at a comma', () => {
    expect(nameFromText('Ada Lovelace')).toEqual({ firstName: 'Ada', lastName: 'Lovelace', fullName: 'Ada Lovelace' });
    expect(nameFromText('Lovelace, Ada')).toEqual({ firstName: 'Ada', lastName: 'Lovelace', fullName: 'Ada Lovelace' });
  });

  it('reads through pasted quotes and odd spaces', () => {
    expect(nameFromText('"Ada Lovelace"')).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
      fullName: 'Ada Lovelace',
    });
  });
});
