import { SearchField as AriaSearchField, type SearchFieldProps as AriaSearchFieldProps, Input, Button } from 'react-aria-components';
import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { bezier } from '../../lib/bezier.ts';
import { Kbd } from '../Kbd/Kbd.tsx';
import './SearchField.css';

/** Props for SearchField. */
export interface SearchFieldProps extends Omit<AriaSearchFieldProps, 'children' | 'className'> {
  /** Names the field for screen readers ("Search people"). */
  readonly label?: string;
  readonly placeholder?: string;
  /** `sm` 28px in toolbars, `md` 36px (the default). */
  readonly size?: 'sm' | 'md';
  /** A shortcut that focuses the field from anywhere, shown as a Kbd while it is empty: "⌘K" (also Ctrl+K) or one key such as "/". */
  readonly shortcut?: string;
  readonly className?: string;
}

const num = (el: Element, name: string, fallback: number) => {
  const v = parseFloat(getComputedStyle(el).getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
};

/** One soft streak per word under the cleared text: four radial gradients in the text colour (transitions.dev 13). */
function glowFor(text: string, input: HTMLInputElement, width: number): string {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return '';
  ctx.font = getComputedStyle(input).font;
  const pad = input.offsetLeft;
  const layers: string[] = [];
  let x = 0;
  for (const seg of text.split(/(\s+)/)) {
    const w = ctx.measureText(seg).width;
    if (seg.trim()) {
      const c = pad + x + w / 2;
      const hw = Math.max(w * 0.45, 8) * 1.5;
      for (const [dx, rw, rh, a] of [[0, 0.8, 7, 0.22], [hw * 0.45, 0.55, 8, 0.18], [-hw * 0.4, 0.65, 6, 0.16], [hw * 0.15, 0.9, 5, 0.14]] as const) {
        const lx = (((c + dx) / width) * 100).toFixed(2);
        layers.push(`radial-gradient(ellipse ${Math.max(hw * rw, 2).toFixed(1)}px ${rh}px at ${lx}% 100%, color-mix(in srgb, var(--text) ${Math.round(a * 100)}%, transparent), transparent)`);
      }
    }
    x += w;
  }
  return layers.join(', ');
}

/** An outlined pill for filtering a list or opening search. The clear button and Esc dissolve the text away; an optional shortcut focuses it. */
export function SearchField({ label = 'Search', placeholder = 'Search', size = 'md', shortcut, className, value, defaultValue, onChange, onClear, ...rest }: SearchFieldProps) {
  const [own, setOwn] = useState(defaultValue ?? '');
  const text = value ?? own;
  const last = useRef(text);
  const inputRef = useRef<HTMLInputElement>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const phRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const frame = useRef(0);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  useEffect(() => {
    if (!shortcut) return;
    const meta = shortcut.startsWith('⌘');
    const key = shortcut.slice(-1).toLowerCase();
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if (e.key.toLowerCase() !== key || (meta ? !(e.metaKey || e.ctrlKey) : e.metaKey || e.ctrlKey || typing)) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcut]);

  // transitions.dev 13 input clear with dissolve: the old text falls 12px and fades out, the placeholder drops in from above,
  // and a streak glows under each word (out and in 400ms on smooth-out, glow over 1000ms peaking at 15%).
  const dissolve = (old: string) => {
    const clip = clipRef.current, mirror = mirrorRef.current, ph = phRef.current, glow = glowRef.current, input = inputRef.current;
    if (!clip || !mirror || !ph || !glow || !input || !old || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    cancelAnimationFrame(frame.current);
    const slow = num(clip, '--duration-slow', 400);
    const total = slow * 2.5;
    const fly = num(clip, '--distance-medium', 12);
    const delay = num(clip, '--duration-stagger', 40);
    const peak = num(clip, '--tf-search-glow-peak', 0.42);
    const ease = bezier(getComputedStyle(clip).getPropertyValue('--ease-smooth-out'));
    mirror.textContent = old.replace(/ /g, ' ');
    glow.style.background = glowFor(old, input, clip.clientWidth || 240);
    clip.dataset.clearing = '';
    const t0 = performance.now();
    const tick = (now: number) => {
      const el = now - t0;
      const e = ease(Math.min(1, el / slow));
      mirror.style.transform = `translateY(${(e * fly).toFixed(1)}px)`;
      mirror.style.opacity = (1 - e).toFixed(3);
      ph.style.transform = `translateY(${(-fly + e * fly).toFixed(1)}px)`;
      ph.style.opacity = (0.9 + e * 0.1).toFixed(3);
      let g = 0;
      if (el > delay) {
        const gp = Math.min(1, (el - delay) / Math.max(1, total - delay));
        g = gp < 0.15 ? gp / 0.15 : 1 - (gp - 0.15) / 0.85;
      }
      glow.style.opacity = (g * peak).toFixed(3);
      if (el < total) frame.current = requestAnimationFrame(tick);
      else {
        delete clip.dataset.clearing;
        mirror.style.cssText = ''; ph.style.cssText = ''; glow.style.cssText = '';
        mirror.textContent = '';
      }
    };
    frame.current = requestAnimationFrame(tick);
  };

  return (
    <AriaSearchField
      {...rest}
      aria-label={label}
      value={text}
      onChange={(v) => { if (v) last.current = v; setOwn(v); onChange?.(v); }}
      onClear={() => { dissolve(last.current); onClear?.(); }}
      className={cx('tf-search', `tf-search--${size}`, className)}
    >
      <Search className="tf-search__icon" size={size === 'sm' ? 14 : 16} strokeWidth={1.75} aria-hidden="true" />
      <div className="tf-search__clip" ref={clipRef}>
        <Input ref={inputRef} className="tf-search__input" placeholder={placeholder} />
        <div className="tf-search__mirror" ref={mirrorRef} aria-hidden="true" />
        <div className="tf-search__ph" ref={phRef} aria-hidden="true">{placeholder}</div>
        <div className="tf-search__glow" ref={glowRef} aria-hidden="true" />
      </div>
      {shortcut && <span className="tf-search__kbd" aria-hidden="true"><Kbd>{shortcut}</Kbd></span>}
      <Button className="tf-search__clear" aria-label="Clear search">
        <X size={14} strokeWidth={1.75} />
      </Button>
    </AriaSearchField>
  );
}
