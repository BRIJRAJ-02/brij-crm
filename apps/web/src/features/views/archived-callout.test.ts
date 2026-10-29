// The Callout a view shows when it filters or sorts on archived fields (spec 0020, AC-480): it names them, in the
// spec's words, so a view that suddenly shows more than it was saved to says why.
import { describe, expect, it } from 'vitest';
import { strings } from './strings.ts';

describe('the archived fields Callout', () => {
  it('names one field in the spec’s words', () => {
    expect(strings.archivedInView(['Stage'])).toBe(
      'This view uses Stage, which is archived. It’s left out until the attribute is restored. Saving a new filter removes it for good.',
    );
  });

  it('names several as a list', () => {
    expect(strings.archivedInView(['Stage', 'Region', 'Owner'])).toBe(
      'This view uses Stage, Region, and Owner, which are archived. They’re left out until the attributes are restored. Saving a new filter removes them for good.',
    );
  });
});
