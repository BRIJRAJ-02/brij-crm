// Settings › Workspace › General's name, saved when the field is left: only a
// real change renames, an empty name is refused, and spaces round it don't count.
import { describe, expect, it } from 'vitest';
import { nameCommit } from './general-form.ts';

describe('the General name rule', () => {
  it('does nothing while the name matches, spaces round it included', () => {
    expect(nameCommit('Acme', 'Acme')).toEqual({ kind: 'same' });
    expect(nameCommit('Acme', '  Acme ')).toEqual({ kind: 'same' });
  });

  it('renames to the trimmed name when it changed', () => {
    expect(nameCommit('Acme', ' Acme Labs ')).toEqual({ kind: 'rename', name: 'Acme Labs' });
  });

  it('refuses an emptied name, so nothing is saved and the field says so', () => {
    expect(nameCommit('Acme', '')).toEqual({ kind: 'missing' });
    expect(nameCommit('Acme', '   ')).toEqual({ kind: 'missing' });
  });
});
