// The Callout a view shows when it filters or sorts on archived fields (spec 0020, AC-480): it names them, in one
// sentence (30 October 2026, shortened from the spec's three), so a view that suddenly shows more than it was saved to says why.
import { describe, expect, it } from 'vitest';
import { strings } from './strings.ts';

describe('the archived fields Callout', () => {
  it('names one field in the spec’s words', () => {
    expect(strings.archivedInView(['Stage'])).toBe('This view uses Stage, which is archived, so it’s left out.');
  });

  it('names several as a list', () => {
    expect(strings.archivedInView(['Stage', 'Region', 'Owner'])).toBe(
      'This view uses Stage, Region, and Owner, which are archived, so they’re left out.',
    );
  });
});
