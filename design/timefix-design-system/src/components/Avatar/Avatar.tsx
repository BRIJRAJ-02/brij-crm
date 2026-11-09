import type { ReactNode } from 'react';
import { cx } from '../../lib/cx.ts';
import type { Hue } from '../Tag/Tag.tsx';
import './Avatar.css';

const HUES: ReadonlyArray<Hue> = ['blue', 'green', 'orange', 'purple', 'sky', 'red', 'lime', 'yellow'];
/** The same name always gets the same hue. */
export function hueFor(name: string): Hue {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length] ?? 'gray';
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '')).toUpperCase();
}

/** Props for Avatar. */
export interface AvatarProps {
  readonly name: string;
  readonly src?: string;
  /** 20 inline, 28 rows (default), 44 headers. */
  readonly size?: 20 | 28 | 36 | 44;
  /** Rounded square for companies, workspaces and pages; round for people. */
  readonly shape?: 'round' | 'square';
  readonly status?: 'online' | 'away';
}

/** A person (round) or a company or workspace (square): photo, else initials on the name's hue. */
export function Avatar({ name, src, size = 28, shape = 'round', status }: AvatarProps) {
  const hue = hueFor(name);
  return (
    <span className={cx('tf-avatar', `tf-avatar--${shape}`)} style={{ '--tf-av': `${size}px`, background: src ? undefined : `var(--tag-${hue}-bg)`, color: `var(--tag-${hue}-text)` } as React.CSSProperties} role="img" aria-label={name}>
      {src ? <img src={src} alt="" /> : <span aria-hidden="true">{shape === 'square' ? initials(name).slice(0, 1) : initials(name)}</span>}
      {status && <span className={`tf-avatar__status tf-avatar__status--${status}`} />}
    </span>
  );
}

/** Overlapping avatars; shows `max`, then a "+n". */
export function AvatarGroup({ names, max = 4, size = 28 }: { readonly names: ReadonlyArray<string>; readonly max?: number; readonly size?: AvatarProps['size'] }) {
  const shown = names.slice(0, max);
  return (
    <span className="tf-avatar-group" aria-label={names.join(', ')}>
      {shown.map((n) => <Avatar key={n} name={n} size={size} />)}
      {names.length > max && <span className="tf-avatar tf-avatar--round tf-avatar--more" style={{ '--tf-av': `${size}px` } as React.CSSProperties}>+{names.length - max}</span>}
    </span>
  );
}

/** A person or record as two lines: avatar, name, grey sub-line. The one way a person is drawn in a row. `isTextHidden` fades the two lines out (a folded sidebar rail keeps only the avatar). */
export function PersonLine({ name, sub, src, shape, size = 28, status, isTextHidden, end }: { readonly name: string; readonly sub?: ReactNode; readonly src?: string; readonly shape?: AvatarProps['shape']; readonly size?: AvatarProps['size']; readonly status?: AvatarProps['status']; readonly isTextHidden?: boolean; readonly end?: ReactNode }) {
  return (
    <span className="tf-person" data-text-hidden={isTextHidden || undefined}>
      <Avatar name={name} src={src} shape={shape} size={size} status={status} />
      <span className="tf-person__text"><span className="tf-person__name">{name}</span>{sub !== undefined && <span className="tf-person__sub">{sub}</span>}</span>
      {end}
    </span>
  );
}
