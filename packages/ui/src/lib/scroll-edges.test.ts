import { describe, expect, it } from 'vitest';
import { scrollEdgesOf } from './scroll-edges.ts';

describe('scrollEdgesOf', () => {
  it('reports nothing when the content fits', () => {
    expect(scrollEdgesOf({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 })).toEqual({ start: false, end: false });
  });

  it('reports the end at the start of a wide table', () => {
    expect(scrollEdgesOf({ scrollLeft: 0, scrollWidth: 600, clientWidth: 300 })).toEqual({ start: false, end: true });
  });

  it('reports both ends in the middle', () => {
    expect(scrollEdgesOf({ scrollLeft: 120, scrollWidth: 600, clientWidth: 300 })).toEqual({ start: true, end: true });
  });

  it('reports the start at the end', () => {
    expect(scrollEdgesOf({ scrollLeft: 300, scrollWidth: 600, clientWidth: 300 })).toEqual({ start: true, end: false });
  });

  it('reads a right to left frame by its size', () => {
    expect(scrollEdgesOf({ scrollLeft: -300, scrollWidth: 600, clientWidth: 300 })).toEqual({
      start: true,
      end: false,
    });
  });
});
