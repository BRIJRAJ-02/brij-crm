import { describe, expect, it } from 'vitest';
import { withOption, withoutOption } from './option-values.ts';

describe('withOption', () => {
  it('adds a made option to a list, and replaces one choice', () => {
    expect(withOption(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(withOption(null, 'b', true)).toEqual(['b']);
    expect(withOption('a', 'b', false)).toBe('b');
  });
});

describe('withoutOption', () => {
  it('takes a refused option out of a list, and clears it as the one choice', () => {
    expect(withoutOption(['a', 'b'], 'b')).toEqual(['a']);
    expect(withoutOption('b', 'b')).toBeNull();
    // A choice changed meanwhile stays.
    expect(withoutOption('a', 'b')).toBe('a');
  });
});
