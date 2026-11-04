// Keeps toasts off the buttons people press next. A Modal's or a Panel's footer (Save, Cancel) claims its place;
// ToastRegion reads the claims and, when its toasts would sit over one, rises above it. A file of its own, apart from
// context.ts, so a page that draws no footer loads none of it, and the hosted form (UiProviderBase, no region) gets
// no store at all: its footers claim nothing.
import { createContext, useCallback, useContext } from 'react';

/** A box in the window's pixels, as laid out: transforms (a drawer sliding in, a sheet rising) are left out. */
export interface LayoutBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The footers toasts keep clear of: claimed by the overlays that draw them, read by ToastRegion. */
export interface ToastClearance {
  /** Claims a footer; the function returned gives the claim back. */
  readonly claim: (footer: HTMLElement) => () => void;
  readonly subscribe: (listener: () => void) => () => void;
  /** The footers claimed now, the same array until a claim changes (for useSyncExternalStore). */
  readonly current: () => readonly HTMLElement[];
}

/** Makes the store UiProvider holds once. Its state lives in this closure, never at module level. */
export function createToastClearance(): ToastClearance {
  let claimed: readonly HTMLElement[] = [];
  const listeners = new Set<() => void>();
  const tell = () => {
    for (const listener of listeners) listener();
  };
  return {
    claim: (footer) => {
      claimed = [...claimed, footer];
      tell();
      return () => {
        claimed = claimed.filter((one) => one !== footer);
        tell();
      };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    current: () => claimed,
  };
}

/** UiProvider's store. Undefined under UiProviderBase, where no toasts are drawn. */
export const ToastClearanceContext = createContext<ToastClearance | undefined>(undefined);

/**
 * A ref for an overlay's footer: while it is mounted, toasts keep off it. Modal's and Panel's footers use it; a
 * screen never does.
 */
export function useToastClearance(): (footer: HTMLElement | null) => (() => void) | undefined {
  const clearance = useContext(ToastClearanceContext);
  return useCallback(
    (footer: HTMLElement | null) => (footer === null || clearance === undefined ? undefined : clearance.claim(footer)),
    [clearance],
  );
}

/**
 * Where an element is laid out in the window, from its offsets up to its fixed overlay. Offsets leave transforms
 * out, so a drawer still sliding in, or a sheet still rising, already measures where it will rest.
 */
export function layoutBox(element: HTMLElement): LayoutBox {
  let left = 0;
  let top = 0;
  for (let node: Element | null = element; node instanceof HTMLElement; node = node.offsetParent) {
    left += node.offsetLeft;
    top += node.offsetTop;
  }
  return { left, top, right: left + element.offsetWidth, bottom: top + element.offsetHeight };
}

/**
 * How far the toasts rise, in pixels, so the region's foot meets the top of the highest footer it would cover; 0
 * when it covers none. It never rises past the window's top. Pure, so Node tests it.
 */
export function toastLift(region: LayoutBox, footers: readonly LayoutBox[]): number {
  const lifts = footers
    .filter(
      (footer) =>
        footer.right > footer.left &&
        footer.left < region.right &&
        region.left < footer.right &&
        footer.top < region.bottom &&
        region.top < footer.bottom,
    )
    .map((footer) => region.bottom - footer.top);
  return Math.max(0, Math.min(region.top, Math.max(0, ...lifts)));
}
