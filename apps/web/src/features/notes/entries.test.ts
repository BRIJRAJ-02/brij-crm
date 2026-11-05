import { describe, expect, it } from 'vitest';
import { refOf } from '../duplicates/merge/pair.ts';
import { noteHref } from './entries.ts';

describe('New note on the Notes page', () => {
  it('reads the one record the picker hands back, alone or in a list of one', () => {
    const ref = { objectId: 'people', recordId: 'ada' };
    expect(refOf(ref)).toEqual(ref);
    expect(refOf([ref])).toEqual(ref);
    expect(refOf(null)).toBeUndefined();
    expect(refOf([])).toBeUndefined();
  });

  it('opens a new note on the picked record’s Notes tab', () => {
    expect(noteHref('acme', 'people', 'ada', 'new')).toBe('/w/acme/objects/people/ada/notes?note=new');
  });
});
