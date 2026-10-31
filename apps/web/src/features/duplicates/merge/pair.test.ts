import { describe, expect, it } from 'vitest';
import { keptFirst, refOf } from './pair.ts';

const OLDER = '01a19000-0000-7000-8000-000000000001';
const NEWER = '01a19100-0000-7000-8000-000000000002';

describe('the merge pair (spec 0049, AC-4910)', () => {
  it('keeps the older record and merges the newer away, whichever order they come in, until swapped', () => {
    expect(keptFirst(OLDER, NEWER, false)).toEqual({ keepId: OLDER, mergeId: NEWER });
    expect(keptFirst(NEWER, OLDER, false)).toEqual({ keepId: OLDER, mergeId: NEWER });
    expect(keptFirst(NEWER, OLDER, true)).toEqual({ keepId: NEWER, mergeId: OLDER });
  });

  it('reads a picked reference, one or the first of a list, and nothing else', () => {
    const ref = { objectId: 'people', recordId: OLDER };
    expect(refOf(ref)).toEqual(ref);
    expect(refOf([ref])).toEqual(ref);
    expect(refOf(null)).toBeUndefined();
    expect(refOf({ recordId: 1 })).toBeUndefined();
  });
});
