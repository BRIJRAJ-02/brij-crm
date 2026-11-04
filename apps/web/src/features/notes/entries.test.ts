import { describe, expect, it } from 'vitest';
import { noteHref, pickedRef } from './entries.ts';

describe('pickedRef (New note on the Notes page)', () => {
  it('takes the one record a single picker hands back, alone or in a list of one', () => {
    const ref = { objectId: 'people', recordId: 'ada' };
    expect(pickedRef(ref)).toEqual(ref);
    expect(pickedRef([ref])).toEqual(ref);
  });

  it('answers nothing for an empty pick or another shape', () => {
    expect(pickedRef(null)).toBeUndefined();
    expect(pickedRef([])).toBeUndefined();
    expect(pickedRef('ada')).toBeUndefined();
    expect(pickedRef({ recordId: 'ada' })).toBeUndefined();
  });

  it('opens a new note on the picked record’s Notes tab', () => {
    expect(noteHref('acme', 'people', 'ada', 'new')).toBe('/w/acme/objects/people/ada/notes?note=new');
  });
});
