import { RadioGroup, Radio, Label, Link as AriaLink } from 'react-aria-components';
import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Check } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import type { Hue } from '../Tag/Tag.tsx';
import { PopNumber } from '../Pagination/Pagination.tsx';
import './Card.css';

/** Props for Card. */
export interface CardProps {
  readonly title?: string;
  readonly description?: string;
  /** Top right: a `CardLink` ("See all") or a small button. */
  readonly action?: ReactNode;
  readonly children?: ReactNode;
  /** `flush` drops the body padding (a list to the edges). */
  readonly flush?: boolean;
  readonly className?: string;
}

/** A white card with a hairline: one block of related content, with an optional title row. */
export function Card({ title, description, action, children, flush = false, className }: CardProps) {
  return (
    <section className={cx('tf-card', className)}>
      {(title !== undefined || action !== undefined) && (
        <div className="tf-card__head">
          <div className="tf-card__titles">
            {title !== undefined && <h3 className="tf-card__title">{title}</h3>}
            {description !== undefined && <p className="tf-card__desc">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children !== undefined && <div className={cx('tf-card__body', flush && 'tf-card__body--flush')}>{children}</div>}
    </section>
  );
}

/** "See all", "Learn more": a quiet link whose chevron slides and opens into an arrow on hover (transitions.dev 24). */
export function CardLink({ children, href, onPress }: { readonly children: ReactNode; readonly href?: string; readonly onPress?: () => void }) {
  return (
    <AriaLink href={href} onPress={onPress} className="tf-card-link">
      {children}
      <span className="tf-card-link__chev" aria-hidden="true">
        <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
          <path className="tf-card-link__arm tf-card-link__arm--top" d="M6 4L10 8" />
          <path className="tf-card-link__arm tf-card-link__arm--bot" d="M10 8L6 12" />
        </svg>
      </span>
    </AriaLink>
  );
}

/** Props for Shell. */
export interface ShellProps {
  /** A small grey label at the top of the shell ("This week"). */
  readonly title?: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
  /** Lay the cards in this many equal columns (they wrap below 200px each). Default: a stack. */
  readonly columns?: number;
}

/** The tinted outer container that groups related cards: 6px of `surface-shell` around 14px-radius cards. */
export function Shell({ title, action, children, columns }: ShellProps) {
  return (
    <div className="tf-cardshell">
      {(title !== undefined || action !== undefined) && (
        <div className="tf-cardshell__head"><span className="tf-cardshell__title">{title}</span>{action}</div>
      )}
      <div className={cx('tf-cardshell__grid', columns !== undefined && 'tf-cardshell__grid--cols')} style={columns !== undefined ? { '--tf-cols': columns } as React.CSSProperties : undefined}>{children}</div>
    </div>
  );
}

/** One row of a StatCard breakdown: label, share and a data hue. */
export interface StatShare { readonly label: string; readonly share: number; readonly hue?: Hue }

/** Props for StatCard. */
export interface StatCardProps {
  readonly label: string;
  /** A 16px icon in a grey well, top right. */
  readonly icon?: ReactNode;
  /** The number; leave undefined while loading ("—"). */
  readonly value?: number;
  readonly format?: (n: number) => string;
  /** The change and what it is against: `{ value: '+12%', direction: 'up', note: 'vs last week' }`. */
  readonly delta?: { readonly value: string; readonly direction: 'up' | 'down' | 'flat'; readonly note?: string; readonly isGood?: boolean };
  /** A small line of the recent trend under the number. */
  readonly sparkline?: ReadonlyArray<number>;
  /** Thin inline bars with their share in % (Mercury's breakdown rows). */
  readonly breakdown?: ReadonlyArray<StatShare>;
}

function Sparkline({ points, isPlaceholder }: { readonly points: ReadonlyArray<number>; readonly isPlaceholder: boolean }) {
  const w = 120;
  const h = 32;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const xy = points.map((v, n) => [(n / Math.max(1, points.length - 1)) * w, h - 2 - ((v - min) / Math.max(1, max - min)) * (h - 4)] as const);
  const last = xy[xy.length - 1];
  return (
    <svg className={cx('tf-stat__spark', isPlaceholder && 'is-placeholder')} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={xy.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" vectorEffect="non-scaling-stroke" />
      {last && !isPlaceholder && <circle cx={last[0]} cy={last[1]} r={2.5} className="tf-stat__spark-end" />}
    </svg>
  );
}

/** A number that matters: grey label with an icon well, the value (its changed digits pop in), a delta line, and an optional sparkline or breakdown bars. */
export function StatCard({ label, icon, value, format, delta, sparkline, breakdown }: StatCardProps) {
  const loading = value === undefined;
  const Arrow = delta?.direction === 'down' ? ArrowDownRight : ArrowUpRight;
  const good = delta ? (delta.isGood ?? delta.direction === 'up') : true;
  return (
    <section className="tf-card tf-stat" aria-busy={loading || undefined}>
      <div className="tf-stat__head">
        <span className="tf-stat__label">{label}</span>
        {icon !== undefined && <span className="tf-stat__well">{icon}</span>}
      </div>
      <div className="tf-stat__value">{loading ? <span className="tf-faint">—</span> : <PopNumber value={value} format={format} animateOnMount />}</div>
      {delta !== undefined && !loading && (
        <p className="tf-stat__delta">
          {delta.direction !== 'flat' && <span className={cx('tf-stat__change', good ? 'is-good' : 'is-bad')}><Arrow size={14} strokeWidth={2} aria-hidden="true" />{delta.value}</span>}
          {delta.direction === 'flat' && <span className="tf-stat__change">{delta.value}</span>}
          {delta.note !== undefined && <span> {delta.note}</span>}
        </p>
      )}
      {sparkline !== undefined && <Sparkline points={loading ? [3, 5, 4, 6, 5, 7, 6] : sparkline} isPlaceholder={loading} />}
      {breakdown !== undefined && (
        <ul className="tf-stat__bars">
          {breakdown.map((b) => (
            <li key={b.label} className="tf-stat__bar">
              <span className="tf-stat__bar-label">{b.label}</span>
              <span className="tf-stat__bar-share">{loading ? '—' : `${Math.round(b.share)}%`}</span>
              <span className="tf-stat__bar-track" aria-hidden="true"><span className="tf-stat__bar-fill" style={{ width: `${loading ? 0 : b.share}%`, background: `var(--dot-${b.hue ?? 'gray'})` }} /></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One choice card. */
export interface TileItem { readonly id: string; readonly title: string; readonly description?: string; readonly icon?: ReactNode; readonly isDisabled?: boolean }

/** Props for TileGrid. */
export interface TileGridProps {
  readonly label: string;
  readonly items: ReadonlyArray<TileItem>;
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onChange?: (id: string) => void;
  /** Columns at full width; tiles wrap to fit (min 160px). */
  readonly columns?: number;
  readonly isLabelHidden?: boolean;
}

/** Selectable cards with radio semantics: pick one template, location or plan. The chosen card gets an accent edge and a check badge that pops in. */
export function TileGrid({ label, items, value, defaultValue, onChange, columns = 3, isLabelHidden = false }: TileGridProps) {
  return (
    <RadioGroup value={value} defaultValue={defaultValue} onChange={onChange} className="tf-tiles">
      <Label className={isLabelHidden ? 'tf-sr-only' : 'tf-tiles__label'}>{label}</Label>
      <div className="tf-tiles__grid" style={{ '--tf-cols': columns } as React.CSSProperties}>
        {items.map((it) => (
          <Radio key={it.id} value={it.id} isDisabled={it.isDisabled} className="tf-tile">
            {it.icon !== undefined && <span className="tf-tile__icon">{it.icon}</span>}
            <span className="tf-tile__title">{it.title}</span>
            {it.description !== undefined && <span className="tf-tile__desc">{it.description}</span>}
            <span className="tf-tile__badge" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
          </Radio>
        ))}
      </div>
    </RadioGroup>
  );
}
