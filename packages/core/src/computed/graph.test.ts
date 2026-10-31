// The dependency graph's rules (spec 0015, AC-326): loops named, depth 3 at most, inputs before readers.
import { describe, expect, it } from 'vitest';
import { checkGraph, dependentsInOrder } from './graph.ts';

const titles = new Map([
  ['rollup', 'Total'],
  ['lookup', 'Company total'],
  ['formula', 'Share'],
  ['fourth', 'Fourth'],
  ['plain', 'Amount'],
]);

describe('checkGraph', () => {
  it('gives a computed attribute one more than its deepest input', () => {
    const edges = [
      { computedId: 'rollup', inputId: 'plain' },
      { computedId: 'lookup', inputId: 'rollup' },
    ];
    expect(checkGraph(edges, 'formula', ['lookup', 'plain'], titles)).toEqual({ ok: true, depth: 3 });
  });

  it('refuses a fourth level', () => {
    const edges = [
      { computedId: 'rollup', inputId: 'plain' },
      { computedId: 'lookup', inputId: 'rollup' },
      { computedId: 'formula', inputId: 'lookup' },
    ];
    expect(checkGraph(edges, 'fourth', ['formula'], titles)).toEqual({
      ok: false,
      message: 'Computed attributes can build on each other at most 3 deep.',
    });
  });

  it('refuses a loop, naming the input it goes through', () => {
    const edges = [
      { computedId: 'lookup', inputId: 'rollup' },
      { computedId: 'formula', inputId: 'lookup' },
    ];
    expect(checkGraph(edges, 'rollup', ['formula'], titles)).toEqual({
      ok: false,
      message: 'Total would depend on itself through Share.',
    });
  });

  it('leaves the attribute’s own old edges out', () => {
    const edges = [{ computedId: 'formula', inputId: 'lookup' }];
    expect(checkGraph(edges, 'formula', ['plain'], titles)).toEqual({ ok: true, depth: 1 });
  });
});

describe('dependentsInOrder', () => {
  it('puts every input before what reads it', () => {
    const edges = [
      { computedId: 'formula', inputId: 'lookup' },
      { computedId: 'lookup', inputId: 'rollup' },
      { computedId: 'rollup', inputId: 'plain' },
    ];
    expect(dependentsInOrder(edges, ['plain'])).toEqual(['rollup', 'lookup', 'formula']);
  });
});
