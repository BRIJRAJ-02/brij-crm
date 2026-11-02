import { describe, expect, it, vi } from 'vitest';
import { collapseAway } from './motion.ts';

// The behaviour lives in Motion.stories.tsx, which runs in real browsers. This
// checks the promise the helpers make where there is no browser at all: the
// removal still happens, so a row is never stranded on screen.
describe('collapseAway', () => {
  it('removes the row when there is no element to animate', () => {
    const remove = vi.fn();
    collapseAway(undefined, remove);
    expect(remove).toHaveBeenCalledOnce();
  });

  it('removes the row when the element is gone', () => {
    const remove = vi.fn();
    collapseAway(null, remove);
    expect(remove).toHaveBeenCalledOnce();
  });
});
