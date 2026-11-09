import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '../../lib/cx.ts';
import './Motion.css';

/** A number whose digits roll vertically when it changes; tabular so the width holds still. */
export function NumberRoll({ value, format = (n: number) => n.toLocaleString('en-US') }: { readonly value: number; readonly format?: (n: number) => string }) {
  const text = format(value);
  const prev = useRef(text);
  const up = useRef(true);
  if (prev.current !== text) {
    up.current = value >= Number(prev.current.replace(/[^0-9.-]/g, ''));
    prev.current = text;
  }
  return (
    <span className="tf-roll" aria-label={text}>
      {[...text].map((ch, i) =>
        /\d/.test(ch) ? (
          <span key={`${text.length - i}`} className="tf-roll__digit" aria-hidden="true">
            <span className="tf-roll__strip" style={{ transform: `translateY(${-Number(ch) * 10}%)` }}>
              {'0123456789'.split('').map((d) => <span key={d}>{d}</span>)}
            </span>
          </span>
        ) : (
          <span key={`s${text.length - i}`} aria-hidden="true">{ch}</span>
        ),
      )}
    </span>
  );
}

/** Crossfades between labels (a save button's "Save", "Saving", "Saved"), keeping the widest width so nothing jumps. */
export function TextSwap({ children, swapKey }: { readonly children: ReactNode; readonly swapKey: string }) {
  const [items, setItems] = useState([{ key: swapKey, node: children }]);
  useEffect(() => {
    setItems((list) => (list[list.length - 1]?.key === swapKey ? list : [...list.slice(-1), { key: swapKey, node: children }]));
    const t = window.setTimeout(() => setItems((list) => list.slice(-1)), 200);
    return () => window.clearTimeout(t);
  }, [swapKey, children]);
  return (
    <span className="tf-swap">
      {items.map((it, i) => (
        <span key={it.key} className={i === items.length - 1 ? 'tf-swap__in' : 'tf-swap__out'} aria-hidden={i !== items.length - 1}>{it.node}</span>
      ))}
    </span>
  );
}

/** A tick that draws itself: confirmation inside buttons, menu items and toasts. */
export function SuccessCheck({ size = 16 }: { readonly size?: number }) {
  return (
    <svg className="tf-check-draw" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" pathLength={1} />
    </svg>
  );
}

/** A small spinner in currentColor for work in flight. */
export function Spinner({ size = 16, label = 'Loading' }: { readonly size?: number; readonly label?: string }) {
  return (
    <svg className="tf-spinner" width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-label={label}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".2" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/** A grey placeholder block that shimmers while content loads. */
export function Skeleton({ width = '100%', height = 12, round = false }: { readonly width?: number | string; readonly height?: number; readonly round?: boolean }) {
  return <span className={`tf-skeleton${round ? ' tf-skeleton--round' : ''}`} style={{ width, height }} aria-hidden="true" />;
}

/** A short label that changes in place, keeping the letters both words share (transitions.dev 33 text morph): "Copy link" → "Copied". */
export function TextMorph({ text }: { readonly text: string }) {
  const shown = useRef(text);
  const swap = useRef<HTMLSpanElement>(null);
  const [from, setFrom] = useState<string>();
  useLayoutEffect(() => {
    if (shown.current === text) return undefined;
    setFrom(shown.current);
    shown.current = text;
    const t = window.setTimeout(() => setFrom(undefined), 300);
    return () => window.clearTimeout(t);
  }, [text]);
  useLayoutEffect(() => {
    const el = swap.current;
    if (!el || from === undefined) return;
    const [out, inn] = [el.children[0] as HTMLElement, el.children[1] as HTMLElement];
    el.style.width = `${out.getBoundingClientRect().width}px`;
    void el.offsetWidth;
    el.classList.add('is-morphing');
    el.style.width = `${inn.getBoundingClientRect().width}px`;
  }, [from]);
  if (from === undefined) return <span className="tf-morph">{text}</span>;
  let a = 0;
  while (a < from.length && a < text.length && from[a] === text[a]) a += 1;
  let b = 0;
  while (b < from.length - a && b < text.length - a && from[from.length - 1 - b] === text[text.length - 1 - b]) b += 1;
  return (
    <span className="tf-morph" aria-label={text}>
      <span aria-hidden="true">{text.slice(0, a)}</span>
      <span ref={swap} className="tf-morph__swap" aria-hidden="true">
        <span className="tf-morph__old">{from.slice(a, from.length - b)}</span>
        <span className="tf-morph__new">{text.slice(a, text.length - b)}</span>
      </span>
      <span aria-hidden="true">{text.slice(text.length - b)}</span>
    </span>
  );
}

/** Settles the soft swap after both its 200ms cross-blur and 240ms width ease, plus a frame of slack. */
const SOFT_SETTLE_MS = 280;

/** A value recomputed in place (a chart's total, a price after a currency change): the old text blurs out as the new blurs in, and the width eases so neighbours glide (transitions.dev 34 text swap soft). `align` keeps right-aligned figures on their edge. */
export function SoftText({ children, align = 'start' }: { readonly children: string; readonly align?: 'start' | 'end' | 'center' }) {
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prev = el.dataset.text;
    el.dataset.text = children;
    if (prev === undefined || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = children; return; }
    if (prev === children) return;
    window.clearTimeout(timer.current);
    const out = document.createElement('span');
    out.className = 'tf-softswap__old';
    out.setAttribute('aria-hidden', 'true');
    out.textContent = prev;
    const inn = document.createElement('span');
    inn.className = 'tf-softswap__new';
    inn.textContent = children;
    const w0 = el.getBoundingClientRect().width;
    el.classList.remove('is-swapping');
    el.replaceChildren(out, inn);
    const w1 = inn.getBoundingClientRect().width;
    el.style.width = `${w0}px`;
    void el.offsetWidth; // reflow so both transitions run
    el.classList.add('is-swapping');
    el.style.width = `${w1}px`;
    timer.current = window.setTimeout(() => {
      el.classList.remove('is-swapping');
      el.style.removeProperty('width');
      el.textContent = children;
    }, SOFT_SETTLE_MS);
  }, [children]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return <span ref={ref} className={`tf-softswap tf-softswap--${align}`} />;
}

/* ---------- list rows ---------- */

/** A row that drops in: its height opens from 0 and it rises 12px into place (new comments, events, tasks). Static when `animate` is false. */
export function DropIn({ children, animate = true }: { readonly children: ReactNode; readonly animate?: boolean }) {
  const [fresh, setFresh] = useState(animate);
  useEffect(() => { if (!fresh) return; const t = window.setTimeout(() => setFresh(false), 320); return () => window.clearTimeout(t); }, [fresh]);
  return <div className={cx('tf-dropin', fresh && 'is-new')}><div className="tf-dropin__inner">{children}</div></div>;
}

/** Collapses its content to nothing (a completed task, an archived notification) and back. Inert while closed. */
export function Collapse({ open, children }: { readonly open: boolean; readonly children: ReactNode }) {
  return <div className="tf-collapse" data-open={open || undefined} inert={!open}><div className="tf-collapse__inner">{children}</div></div>;
}

/* ---------- icons ---------- */

/** Two icons in one slot that cross-fade with blur and scale (transitions.dev 09 icon swap). `isB` shows the second. */
export function IconSwap({ a, b, isB }: { readonly a: ReactNode; readonly b: ReactNode; readonly isB: boolean }) {
  return (
    <span className="tf-iconswap" data-state={isB ? 'b' : 'a'} aria-hidden="true">
      <span className="tf-iconswap__icon" data-icon="a">{a}</span>
      <span className="tf-iconswap__icon" data-icon="b">{b}</span>
    </span>
  );
}

/* ---------- work in progress ---------- */

/** Text with a highlight sweeping across its glyphs (transitions.dev 15 shimmer text): work in progress ("Saving…", "Thinking"). */
export function ShimmerText({ children }: { readonly children: string }) {
  return <span className="tf-shimmer" data-text={children}>{children}</span>;
}

/** One status line that cycles through what the AI is doing, each swap rising out as the next rises in, all shimmering (transitions.dev 28 thinking states). */
export function ThinkingLine({ states, hold = 2000 }: { readonly states: ReadonlyArray<string>; readonly hold?: number }) {
  const [i, setI] = useState(0);
  const [prev, setPrev] = useState<number>();
  useEffect(() => {
    if (states.length < 2) return;
    const t = window.setTimeout(() => { setPrev(i); setI((n) => (n + 1) % states.length); }, hold);
    return () => window.clearTimeout(t);
  }, [i, hold, states.length]);
  useEffect(() => { if (prev === undefined) return; const t = window.setTimeout(() => setPrev(undefined), 200); return () => window.clearTimeout(t); }, [prev]);
  const now = states[i] ?? '';
  const widest = states.reduce((a, b) => (b.length > a.length ? b : a), '');
  return (
    <span className="tf-thinking" role="status" aria-live="polite">
      <span className="tf-thinking__sizer" aria-hidden="true">{widest}</span>
      {prev !== undefined && <span key={`out-${prev}`} className="tf-thinking__text tf-thinking__text--out" data-text={states[prev]} aria-hidden="true">{states[prev]}</span>}
      <span key={`in-${i}`} className={cx('tf-thinking__text', prev !== undefined && 'tf-thinking__text--in')} data-text={now}>{now}</span>
    </span>
  );
}
