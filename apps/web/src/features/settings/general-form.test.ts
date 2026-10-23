// Settings › Workspace › General's name: saved on its own once an edit ends, only for a real change, and never
// empty.
import { describe, expect, it } from 'vitest';
import { nameEdit } from './general-form.ts';

describe('the General name', () => {
  it('does nothing while it matches the saved name, spaces round it included', () => {
    expect(nameEdit('Acme', 'Acme')).toEqual({ kind: 'same' });
    expect(nameEdit('Acme', '  Acme ')).toEqual({ kind: 'same' });
  });

  it('saves the trimmed name when it changed', () => {
    expect(nameEdit('Acme', ' Acme Labs ')).toEqual({ kind: 'save', name: 'Acme Labs' });
  });

  it('refuses an emptied name, spaces only included, so the field can say it is missing', () => {
    expect(nameEdit('Acme', '')).toEqual({ kind: 'missing' });
    expect(nameEdit('Acme', '   ')).toEqual({ kind: 'missing' });
  });
});
