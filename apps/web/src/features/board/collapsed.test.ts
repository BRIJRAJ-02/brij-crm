// The board's folded columns, kept per view in this browser.
import { describe, expect, it } from 'vitest';
import { collapsedKey, parseCollapsed, withCollapsed } from './collapsed.ts';

describe('parseCollapsed', () => {
  it('reads the kept ids', () => {
    expect([...parseCollapsed('["a","b"]')]).toEqual(['a', 'b']);
  });

  it('names none for nothing kept, or something unreadable', () => {
    expect(parseCollapsed(null).size).toBe(0);
    expect(parseCollapsed('{').size).toBe(0);
    expect(parseCollapsed('{"a":1}').size).toBe(0);
    expect([...parseCollapsed('["a",3,null]')]).toEqual(['a']);
  });
});

describe('withCollapsed', () => {
  it('folds and opens a column as a new set', () => {
    const held = new Set(['a']);
    const folded = withCollapsed(held, 'b', true);
    expect([...folded]).toEqual(['a', 'b']);
    expect([...withCollapsed(folded, 'a', false)]).toEqual(['b']);
    expect([...held]).toEqual(['a']);
  });
});

describe('collapsedKey', () => {
  it('keeps each view apart', () => {
    expect(collapsedKey('v1')).not.toBe(collapsedKey('v2'));
  });
});
