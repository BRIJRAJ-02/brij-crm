import type { ReactNode } from 'react';
import { cx } from '../../lib/cx.ts';
import { StatusIcon, type StatusShape } from '../Icon/StatusIcon.tsx';
import './Tag.css';

/** The nine data hues every select option, status and avatar draws from. */
export type Hue = 'gray' | 'red' | 'orange' | 'yellow' | 'lime' | 'green' | 'sky' | 'blue' | 'purple';
/** The hue each status shape takes by default. */
export const STATUS_HUE: Readonly<Record<StatusShape, Hue>> = { draft: 'gray', progress: 'orange', review: 'blue', done: 'green', failed: 'red', waiting: 'gray' };

/** Props for Tag. */
export interface TagProps {
  readonly hue?: Hue;
  /** A status shape before the label; sets the hue unless `hue` is given. */
  readonly status?: StatusShape;
  readonly icon?: ReactNode;
  /** `sm` 22px in tables and selects, `md` 26px, `pill` 30px for invite and booking states. */
  readonly size?: 'sm' | 'md' | 'pill';
  /** A white tag with a hairline, for neutral facts (a price, a plan). */
  readonly outline?: boolean;
  readonly children: ReactNode;
}

/** A select, multi-select or status value. Text and icon take the hue on its soft ground. */
export function Tag({ hue, status, icon, size = 'md', outline = false, children }: TagProps) {
  const h = hue ?? (status ? STATUS_HUE[status] : 'gray');
  const s = size === 'pill' ? 18 : size === 'sm' ? 12 : 14;
  return (
    <span className={cx('tf-tag', `tf-tag--${size}`, outline ? 'tf-tag--outline' : `tf-tag--${h}`)}>
      {status ? <StatusIcon shape={status} size={s} /> : icon}
      {children}
    </span>
  );
}

/** A small dot plus a word: status inside dense text. */
export function StatusDot({ hue = 'gray', children }: { readonly hue?: Hue; readonly children?: ReactNode }) {
  return <span className="tf-dot-label"><span className={`tf-dot tf-dot--${hue}`} aria-hidden="true" />{children}</span>;
}

/** A round count: unread, conflicts, items in a column. `accent` for counts that need attention, `ink` for the selected filter. */
export function Count({ children, tone = 'neutral' }: { readonly children: ReactNode; readonly tone?: 'neutral' | 'accent' | 'ink' }) {
  return <span className={`tf-count tf-count--${tone}`}>{children}</span>;
}
