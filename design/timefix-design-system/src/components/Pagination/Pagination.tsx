import { Button as AriaButton } from 'react-aria-components';
import { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { IconButton } from '../Button/Button.tsx';
import './Pagination.css';

const fmt = (n: number) => n.toLocaleString('en-US');

/**
 * A number whose changed characters pop in from below with a blur (transitions.dev 02, number pop-in).
 * The leading characters the old and new text share stay still; the last two ride in a stagger behind.
 */
export function PopNumber({ value, format = fmt, animateOnMount = false, className }: { readonly value: number | string; readonly format?: (n: number) => string; readonly animateOnMount?: boolean; readonly className?: string }) {
  const text = typeof value === 'number' ? format(value) : value;
  const last = useRef(text);
  const prev = useRef<string | undefined>(animateOnMount ? '' : undefined);
  if (last.current !== text) { prev.current = last.current; last.current = text; }
  const p = prev.current;
  let same = 0;
  if (p !== undefined) while (same < p.length && same < text.length && p[same] === text[same]) same++;
  const chars = [...text];
  return (
    <span className={cx('tf-pop', className)}>
      <span key={text} className={cx('tf-pop__group', p !== undefined && 'is-animating')} aria-hidden="true">
        {chars.map((ch, i) => (
          <span key={i} className="tf-pop__digit" data-same={i < same ? '' : undefined} data-stagger={i === chars.length - 1 ? 2 : i === chars.length - 2 ? 1 : undefined}>{ch}</span>
        ))}
      </span>
      <span className="tf-sr-only">{text}</span>
    </span>
  );
}

/** Which page numbers to draw: always the first and last, the current with one either side, and gaps as "…". */
function pages(current: number, count: number): ReadonlyArray<number | 'gap'> {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const set = new Set([1, count, current - 1, current, current + 1].filter((n) => n >= 1 && n <= count));
  if (current <= 3) [2, 3, 4].forEach((n) => set.add(n));
  if (current >= count - 2) [count - 3, count - 2, count - 1].forEach((n) => set.add(n));
  const sorted = [...set].sort((a, b) => a - b);
  const out: Array<number | 'gap'> = [];
  sorted.forEach((n, i) => { const before = sorted[i - 1]; if (before !== undefined && n - before > 1) out.push('gap'); out.push(n); });
  return out;
}

/** Props for Pagination. Pages are 1-based. */
export interface PaginationProps {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly onPageChange: (page: number) => void;
  /** `compact` shows only the range and the arrows (toolbars, panels); `full` adds page numbers. */
  readonly variant?: 'compact' | 'full';
  /** The plural noun after the total, read by screen readers ("companies"). */
  readonly noun?: string;
}

/** "1–50 of 1,284" with previous and next, and page numbers when there is room. The range pops in as it changes. */
export function Pagination({ page, pageSize, total, onPageChange, variant = 'full', noun = 'results' }: PaginationProps) {
  const count = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className={cx('tf-pager', `tf-pager--${variant}`)} aria-label="Pagination">
      <span className="tf-pager__range" aria-live="polite">
        <PopNumber value={total === 0 ? '0' : `${fmt(from)}–${fmt(to)}`} /> <span className="tf-pager__of">of</span> {fmt(total)}<span className="tf-sr-only"> {noun}</span>
      </span>
      <span className="tf-pager__controls">
        <IconButton size="sm" label="Previous page" isDisabled={page <= 1} onPress={() => onPageChange(page - 1)}><ChevronLeft size={16} strokeWidth={1.75} /></IconButton>
        {variant === 'full' && pages(page, count).map((n, i) => n === 'gap'
          ? <span key={`g${i}`} className="tf-pager__gap" aria-hidden="true">…</span>
          : <AriaButton key={n} className="tf-pager__page" aria-label={`Page ${n}`} aria-current={n === page ? 'page' : undefined} onPress={() => onPageChange(n)}>{fmt(n)}</AriaButton>)}
        <IconButton size="sm" label="Next page" isDisabled={page >= count} onPress={() => onPageChange(page + 1)}><ChevronRight size={16} strokeWidth={1.75} /></IconButton>
      </span>
    </nav>
  );
}
