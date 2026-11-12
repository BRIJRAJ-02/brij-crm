import { useEffect, type RefObject } from 'react';

/**
 * The way into the dashboard (owner, 11 Nov): the workspace builds itself. The surface settles, the sidebar's rows slide in one
 * after another, and each card on the page arrives from a little outside its place and comes together toward the middle, landing
 * as an empty shell that then fills with its content. Runs once per `key` change (0 skips); reduced motion skips it entirely.
 */
export function useAssemble(root: RefObject<HTMLElement | null>, key: number): void {
  useEffect(() => {
    if (!key) return undefined;
    let undo: (() => void) | undefined;
    let frame = 0;
    let tries = 0;
    // Wait until the door has left and the shell has painted (the app can mount before its shell does), then build.
    const tick = () => {
      const el = root.current;
      if (el?.querySelector('.tf-shell__main') && tries > 1) { undo = assemble(el); return; }
      if (++tries < 60) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); undo?.(); };
  }, [root, key]);
}

const SIDE = '.tf-sidebar__head, .tf-sidebar__tools, .tf-sidebar__section-title, .tf-nav, .tf-sidebar__foot';
const MAX_BLOCKS = 28;
const STEP = 35;

function shown(r: DOMRect, view: DOMRect): boolean {
  return r.width > 0 && r.height > 0 && r.bottom > view.top && r.top < view.bottom && r.right > view.left && r.left < view.right;
}

/** A card-like box: it draws an edge or a ground of its own, so it reads as a part being put in place. */
function isBlock(node: HTMLElement, r: DOMRect): boolean {
  if (r.width < 80 || r.height < 28) return false;
  const cs = getComputedStyle(node);
  if (cs.position === 'fixed' || cs.position === 'sticky') return false;
  const edge = parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0 || cs.boxShadow !== 'none';
  const ground = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
  return edge || ground;
}

function findBlocks(main: HTMLElement): HTMLElement[] {
  const view = main.getBoundingClientRect();
  const out: HTMLElement[] = [];
  const walk = (parent: HTMLElement, depth: number) => {
    for (const child of Array.from(parent.children)) {
      if (!(child instanceof HTMLElement) || out.length >= MAX_BLOCKS) continue;
      if (child.closest('[hidden], [inert]') !== null) continue;
      // A wrapper with no box of its own (display: contents) is looked through.
      if (getComputedStyle(child).display === 'contents') { walk(child, depth); continue; }
      const r = child.getBoundingClientRect();
      if (!shown(r, view)) continue;
      if (/^H[1-3]$/.test(child.tagName) || (depth > 0 && isBlock(child, r))) { out.push(child); continue; }
      if (depth < 9) walk(child, depth + 1);
    }
  };
  walk(main, 0);
  return out.sort((x, y) => { const p = x.getBoundingClientRect(); const q = y.getBoundingClientRect(); return p.top - q.top || p.left - q.left; });
}

function assemble(root: HTMLElement): () => void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => undefined;
  const main = root.querySelector<HTMLElement>('.tf-shell__main');
  if (!main) return () => undefined;
  const touched: Array<{ readonly el: HTMLElement; readonly cls: string }> = [];
  const mark = (el: HTMLElement, cls: string, vars: Readonly<Record<string, string>>) => {
    for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
    el.classList.add(cls);
    touched.push({ el, cls });
  };

  mark(main, 'tf-assemble__surface', {});
  const view = new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  Array.from(root.querySelectorAll<HTMLElement>(SIDE)).filter((x) => shown(x.getBoundingClientRect(), view))
    .forEach((x, i) => mark(x, 'tf-assemble__side', { '--tf-as-delay': `${60 + Math.min(i, 18) * 22}ms` }));

  // Each card starts a little outward of where it lands (further from the middle, a touch lower) and comes together.
  const m = main.getBoundingClientRect();
  const cx = m.left + m.width / 2;
  const clamp = (n: number, lim: number) => Math.max(-lim, Math.min(lim, n));
  findBlocks(main).forEach((x, i) => {
    const r = x.getBoundingClientRect();
    const dx = clamp(((r.left + r.width / 2) - cx) * 0.05, 28);
    const dy = 10 + clamp((r.top - m.top) * 0.02, 14);
    mark(x, 'tf-assemble__block', { '--tf-as-x': `${dx.toFixed(1)}px`, '--tf-as-y': `${dy.toFixed(1)}px`, '--tf-as-delay': `${140 + Math.min(i, 16) * STEP}ms` });
  });

  const t = window.setTimeout(clear, 140 + 16 * STEP + 900);
  function clear() {
    for (const { el, cls } of touched) { el.classList.remove(cls); el.style.removeProperty('--tf-as-x'); el.style.removeProperty('--tf-as-y'); el.style.removeProperty('--tf-as-delay'); }
    touched.length = 0;
  }
  return () => { window.clearTimeout(t); clear(); };
}
