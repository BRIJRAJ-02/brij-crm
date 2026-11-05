// Toasts rise just clear of a footer they would cover, and stay put otherwise.
import { describe, expect, it, vi } from 'vitest';
import { createToastClearance, toastLift } from './toast-clearance.ts';

/** A 300 by 44 toast region, 16px off a 1280 by 800 window's bottom right. */
const REGION = { left: 964, top: 740, right: 1264, bottom: 784 };

describe('toastLift', () => {
  it('stays put with no footer', () => {
    expect(toastLift(REGION, [])).toBe(0);
  });

  it('rises to the top of a drawer footer it covers', () => {
    expect(toastLift(REGION, [{ left: 800, top: 754, right: 1280, bottom: 800 }])).toBe(30);
  });

  it('rises above the highest of several footers', () => {
    const footers = [
      { left: 800, top: 754, right: 1280, bottom: 800 },
      { left: 900, top: 700, right: 1280, bottom: 760 },
    ];
    expect(toastLift(REGION, footers)).toBe(84);
  });

  it('ignores a footer beside it or above it', () => {
    expect(toastLift(REGION, [{ left: 400, top: 700, right: 880, bottom: 800 }])).toBe(0);
    expect(toastLift(REGION, [{ left: 800, top: 300, right: 1280, bottom: 346 }])).toBe(0);
  });

  it('ignores a footer with no width (hidden)', () => {
    expect(toastLift(REGION, [{ left: 1000, top: 754, right: 1000, bottom: 800 }])).toBe(0);
  });

  it('never rises past the window top', () => {
    expect(toastLift(REGION, [{ left: 800, top: -100, right: 1280, bottom: 800 }])).toBe(REGION.top);
  });
});

describe('createToastClearance', () => {
  it('lists claims, tells listeners, and gives a claim back', () => {
    const clearance = createToastClearance();
    const listener = vi.fn();
    clearance.subscribe(listener);
    const footer = {} as HTMLElement;
    const before = clearance.current();
    const release = clearance.claim(footer);
    expect(clearance.current()).toEqual([footer]);
    expect(clearance.current()).not.toBe(before);
    release();
    expect(clearance.current()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
