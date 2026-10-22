// Settings › Workspace › General's Save: shown only for a real change, and
// sending only the fields that changed.
import { describe, expect, it } from 'vitest';
import { generalChange, isChanged } from './general-form.ts';

const saved = { name: 'Acme', slug: 'acme' };

describe('the General form', () => {
  it('has nothing to save while the fields match, spaces round the name included', () => {
    const change = generalChange(saved, '  Acme ', 'acme');
    expect(change).toEqual({});
    expect(isChanged(change)).toBe(false);
  });

  it('sends the trimmed name alone when only the name changed', () => {
    expect(generalChange(saved, ' Acme Labs ', 'acme')).toEqual({ name: 'Acme Labs' });
  });

  it('sends the address alone when only the address changed, and both when both did', () => {
    expect(generalChange(saved, 'Acme', 'acme-labs')).toEqual({ slug: 'acme-labs' });
    const both = generalChange(saved, 'Halcyon', 'halcyon');
    expect(both).toEqual({ name: 'Halcyon', slug: 'halcyon' });
    expect(isChanged(both)).toBe(true);
  });

  it('counts an emptied name as a change, so Save can say it is missing', () => {
    expect(generalChange(saved, '   ', 'acme')).toEqual({ name: '' });
  });
});
