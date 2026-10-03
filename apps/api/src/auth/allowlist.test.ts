import { describe, expect, it } from 'vitest';

import { createAllowlist } from './allowlist.ts';

describe('createAllowlist', () => {
  it('opens sign up to every email when the list is * alone', () => {
    const list = createAllowlist('production', ['*']);
    expect(list.open).toBe(true);
    expect(list.allows('anyone@example.com')).toBe(true);
  });

  it('allows only listed emails otherwise, compared lowercased', () => {
    const list = createAllowlist('production', ['ada@example.com']);
    expect(list.open).toBe(false);
    expect(list.allows(' Ada@Example.com ')).toBe(true);
    expect(list.allows('bob@example.com')).toBe(false);
  });

  it('lets no one new in outside local when there is no list, and everyone locally', () => {
    expect(createAllowlist('production', undefined).allows('ada@example.com')).toBe(false);
    expect(createAllowlist('local', undefined).allows('ada@example.com')).toBe(true);
  });
});
