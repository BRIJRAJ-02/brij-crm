import { Breadcrumbs as AriaBreadcrumbs, Breadcrumb, Link, Button as AriaButton, type Key } from 'react-aria-components';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { MenuTrigger, Menu, MenuItem } from '../Menu/Menu.tsx';
import './Breadcrumbs.css';

/** One step of the trail. The last item is the current page. */
export interface Crumb {
  readonly id: string;
  readonly label: string;
  readonly href?: string;
  /** A 16px icon or a 20px Avatar before the label. */
  readonly icon?: ReactNode;
}

/** Props for Breadcrumbs. */
export interface BreadcrumbsProps {
  readonly items: ReadonlyArray<Crumb>;
  /** Called with the id of a crumb that is pressed (for router navigation without hrefs). */
  readonly onAction?: (id: string) => void;
  /** Beyond this many crumbs the middle ones fold into a "…" menu. Default 4. */
  readonly maxVisible?: number;
  /** `title` sets the current page at 15px for the top bar; `sm` is 13px for panels. */
  readonly size?: 'sm' | 'md' | 'title';
  readonly className?: string;
}

const sep = <ChevronRight className="tf-crumbs__sep" size={14} strokeWidth={1.75} aria-hidden="true" />;

/** Where this page sits: parents as grey links, the current page in ink. Long trails, or trails too wide for their space, fold their middle into a menu. */
export function Breadcrumbs({ items, onAction, maxVisible = 4, size = 'md', className }: BreadcrumbsProps) {
  // Folds further, down to "…" plus the current page, while the trail cannot fit with every crumb at its minimum width.
  const ref = useRef<HTMLOListElement>(null);
  const [visible, setVisible] = useState(maxVisible);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => { setVisible(maxVisible); }, [items, maxVisible, width]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.scrollWidth > el.clientWidth + 1 && visible > 2 && items.length > 1) setVisible((v) => Math.min(v, items.length) - 1);
  });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(Math.round(el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const cap = Math.max(2, Math.min(visible, maxVisible));
  const fold = items.length > cap;
  const keepTail = cap >= 3 ? cap - 2 : 1;
  const head = fold ? (cap >= 3 ? items.slice(0, 1) : []) : items;
  const hidden = fold ? items.slice(head.length, items.length - keepTail) : [];
  const tail = fold ? items.slice(items.length - keepTail) : [];
  const crumb = (c: Crumb, isLast: boolean) => (
    <Breadcrumb key={c.id} id={c.id} className="tf-crumbs__item">
      <Link href={isLast ? undefined : c.href} className="tf-crumbs__link">{c.icon}<span className={c.label.length > 5 ? 'tf-crumbs__text is-long' : 'tf-crumbs__text'}>{c.label}</span></Link>
      {!isLast && sep}
    </Breadcrumb>
  );
  return (
    <AriaBreadcrumbs ref={ref} onAction={(k: Key) => onAction?.(String(k))} className={cx('tf-crumbs', `tf-crumbs--${size}`, className)}>
      {head.map((c, i) => crumb(c, !fold && i === items.length - 1))}
      {fold && (
        <Breadcrumb id="__more" className="tf-crumbs__item">
          <MenuTrigger>
            <AriaButton className="tf-crumbs__more" aria-label={`${hidden.length} more pages`}><MoreHorizontal size={16} strokeWidth={1.75} /></AriaButton>
            <Menu aria-label="Hidden pages" placement="bottom start" onAction={(k) => onAction?.(String(k))}>
              {hidden.map((c) => <MenuItem key={c.id} id={c.id} href={c.href} icon={c.icon}>{c.label}</MenuItem>)}
            </Menu>
          </MenuTrigger>
          {sep}
        </Breadcrumb>
      )}
      {tail.map((c, i) => crumb(c, i === tail.length - 1))}
    </AriaBreadcrumbs>
  );
}
