// The name the command menu hands the new record dialog.
import { describe, expect, it } from 'vitest';
import { namePreset } from './name-preset.ts';

describe('namePreset', () => {
  it('fills a text name as typed', () => {
    expect(namePreset({ id: 'a', type: 'text' }, ' Globex ')).toEqual({ a: 'Globex' });
  });

  it('splits a person’s name into first and last', () => {
    expect(namePreset({ id: 'n', type: 'personal_name' }, 'Ada  King Lovelace')).toEqual({
      n: { firstName: 'Ada', lastName: 'King Lovelace', fullName: 'Ada  King Lovelace' },
    });
    expect(namePreset({ id: 'n', type: 'personal_name' }, 'Ada')).toEqual({ n: { firstName: 'Ada', fullName: 'Ada' } });
  });

  it('fills nothing without a name, a name attribute, or one that holds text', () => {
    expect(namePreset({ id: 'a', type: 'text' }, '  ')).toBeUndefined();
    expect(namePreset(undefined, 'Globex')).toBeUndefined();
    expect(namePreset({ id: 'a', type: 'number' }, 'Globex')).toBeUndefined();
  });
});
