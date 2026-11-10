import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * transitions.dev 16 (tabs sliding): measures the selected item inside the bar and writes its
 * offsetLeft / offsetWidth to `--tf-ind-x` / `--tf-ind-w`. The first placement and every resize snap
 * (no `data-ready` while writing), a selection change tweens. CSS owns the tween.
 */
export function useSlidingIndicator(selectedKey: unknown): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  const placed = useRef(false);

  useLayoutEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    const animate = placed.current;
    placed.current = true;
    place(bar, animate);
    if (animate) {
      const sel = bar.querySelector<HTMLElement>('[data-selected]');
      if (sel && bar.scrollWidth > bar.clientWidth) {
        const left = sel.offsetLeft - bar.clientWidth / 2 + sel.offsetWidth / 2;
        bar.scrollTo({ left, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
    }
  }, [selectedKey]);

  useLayoutEffect(() => {
    const bar = ref.current;
    if (!bar || typeof ResizeObserver === 'undefined') return;
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) { first = false; return; }
      place(bar, false);
    });
    ro.observe(bar);
    bar.querySelectorAll('[role="tab"], [role="radio"], button').forEach((el) => ro.observe(el));
    // Web fonts change label widths after the first paint.
    void document.fonts?.ready.then(() => place(bar, false));
    return () => ro.disconnect();
  }, []);

  return ref;
}

function place(bar: HTMLElement, animate: boolean, tries = 0): void {
  const sel = bar.querySelector<HTMLElement>('[data-selected]');
  // Not laid out yet (hidden, or mounting inside a page that is still entering): try again next frame rather than draw a sliver.
  if (sel && (sel.offsetWidth === 0 || bar.offsetWidth === 0)) {
    if (tries < 20) requestAnimationFrame(() => place(bar, false, tries + 1));
    return;
  }
  // Offsets ignore transforms (a dialog scaling in); when the bar is not the item's offset parent, take the bar's own offset off.
  const x = sel ? (sel.offsetParent === bar ? sel.offsetLeft : sel.offsetLeft - bar.offsetLeft) : 0;
  if (!animate) bar.removeAttribute('data-ready');
  bar.style.setProperty('--tf-ind-x', `${x}px`);
  bar.style.setProperty('--tf-ind-w', `${sel ? sel.offsetWidth : 0}px`);
  if (!animate) {
    void bar.offsetWidth;
    bar.setAttribute('data-ready', '');
  }
}
