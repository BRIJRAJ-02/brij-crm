import type { ReactNode } from 'react';
import { Link } from 'react-aria-components';
import { ArrowUpRight, MousePointerClick } from 'lucide-react';
import type { Hue } from '../Tag/Tag.tsx';
import { cx } from '../../lib/cx.ts';
import './LinkList.css';

/** One link on a link page: where it goes, what it says, and how it is told apart at a glance. */
export interface LinkItem {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly href: string;
  /** A 20px mark or Lucide icon at the start of the button, or on the tile. */
  readonly icon?: ReactNode;
  /** A picture for a tile or a featured card. Without one the tile draws its icon on `hue`. */
  readonly image?: string;
  readonly hue?: Hue;
  /** How many times visitors pressed it, shown only in the editor. */
  readonly clicks?: number;
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const isExternal = (href: string) => /^https?:/i.test(href);

/** A link's press count, as the editor shows it: a pointer icon and a compact number ("1.2K"). */
export function ClickCount({ clicks }: { readonly clicks: number }) {
  return (
    <span className="tf-clicks" aria-label={`${clicks} ${clicks === 1 ? 'click' : 'clicks'}`}>
      <MousePointerClick size={12} strokeWidth={1.75} aria-hidden="true" />
      <span className="tf-num" aria-hidden="true">{compact.format(clicks)}</span>
    </span>
  );
}

/** Props shared by LinkList, LinkGrid and LinkCard. */
interface LinkSetProps {
  /** In an editor's phone preview the links don't navigate and show their click counts when `showClicks`. */
  readonly isPreview?: boolean;
  readonly showClicks?: boolean;
}

function linkProps(item: LinkItem, isPreview: boolean) {
  const external = isExternal(item.href);
  return {
    href: isPreview ? undefined : item.href,
    target: external ? '_blank' : undefined,
    rel: external ? 'noopener noreferrer nofollow' : undefined,
    'aria-label': external ? `${item.title} (opens in a new tab)` : undefined,
  };
}

/** Props for LinkList. */
export interface LinkListProps extends LinkSetProps {
  readonly items: ReadonlyArray<LinkItem>;
  readonly label: string;
}

/** A link page's buttons: full width pills, icon at the start, the title centred with an optional line under it. Hover lifts 2px, press eases to 0.97. Reads the page's look from `--tf-lp-*`. */
export function LinkList({ items, label, isPreview = false, showClicks = false }: LinkListProps) {
  return (
    <ul className="tf-linklist" aria-label={label}>
      {items.map((it) => (
        <li key={it.id}>
          <Link className="tf-linklist__btn" {...linkProps(it, isPreview)}>
            <span className="tf-linklist__icon" aria-hidden="true">{it.icon}</span>
            <span className="tf-linklist__text">
              <span className="tf-linklist__title">{it.title}</span>
              {it.subtitle && <span className="tf-linklist__sub">{it.subtitle}</span>}
            </span>
            <span className="tf-linklist__end">{showClicks && it.clicks !== undefined && <ClickCount clicks={it.clicks} />}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Picture({ item, className }: { readonly item: LinkItem; readonly className: string }) {
  return (
    <span className={cx(className, `tf-linkpic--${item.hue ?? 'gray'}`)} aria-hidden="true">
      {item.image ? <img src={item.image} alt="" loading="lazy" /> : <span className="tf-linkpic__icon">{item.icon}</span>}
    </span>
  );
}

/** Props for LinkGrid. */
export interface LinkGridProps extends LinkSetProps {
  readonly items: ReadonlyArray<LinkItem>;
  readonly label: string;
}

/** Links as two tiles to a row: a square picture (or the icon on its hue), the title and a quiet line under it. For shops, videos and posts. */
export function LinkGrid({ items, label, isPreview = false, showClicks = false }: LinkGridProps) {
  return (
    <ul className="tf-linkgrid" aria-label={label}>
      {items.map((it) => (
        <li key={it.id} className="tf-linkgrid__cell">
          <Link className="tf-linkgrid__tile" {...linkProps(it, isPreview)}>
            <Picture item={it} className="tf-linkgrid__pic" />
            <span className="tf-linkgrid__text">
              <span className="tf-linkgrid__title">{it.title}</span>
              {it.subtitle && <span className="tf-linkgrid__sub">{it.subtitle}</span>}
            </span>
            {showClicks && it.clicks !== undefined && <span className="tf-linkgrid__clicks"><ClickCount clicks={it.clicks} /></span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Props for LinkCard. */
export interface LinkCardProps extends LinkSetProps {
  readonly item: LinkItem;
}

/** One featured link as a card: a wide picture area, then the title, a line and an arrow. The one link the owner wants seen first. */
export function LinkCard({ item, isPreview = false, showClicks = false }: LinkCardProps) {
  return (
    <Link className="tf-linkcard" {...linkProps(item, isPreview)}>
      <Picture item={item} className="tf-linkcard__pic" />
      <span className="tf-linkcard__body">
        <span className="tf-linkcard__text">
          <span className="tf-linkcard__title">{item.title}</span>
          {item.subtitle && <span className="tf-linkcard__sub">{item.subtitle}</span>}
        </span>
        {showClicks && item.clicks !== undefined ? <ClickCount clicks={item.clicks} /> : <span className="tf-linkcard__arrow" aria-hidden="true"><ArrowUpRight size={16} strokeWidth={1.75} /></span>}
      </span>
    </Link>
  );
}
