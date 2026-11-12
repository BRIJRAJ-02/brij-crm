import { useRef } from 'react';
import { Focusable } from 'react-aria-components';
import { cx } from '../../lib/cx.ts';
import { Avatar, hueFor } from '../Avatar/Avatar.tsx';
import type { Hue } from '../Tag/Tag.tsx';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import './Presence.css';

/** Props for RemoteCursor. */
export interface RemoteCursorProps {
  /** Whose pointer it is. */
  readonly name: string;
  /** Their presence hue; defaults to their avatar's (`hueFor(name)`). */
  readonly hue?: Hue;
  /** Position in px inside the nearest positioned ancestor. Each new point glides from the last. */
  readonly x: number;
  readonly y: number;
  /** No movement for a while: the name pill folds away, the arrow stays. */
  readonly isIdle?: boolean;
}

/** Another person's pointer on a shared surface (a board, a form builder): an arrow in their hue with a name pill, gliding between updates. */
export function RemoteCursor({ name, hue, x, y, isIdle = false }: RemoteCursorProps) {
  const h = hue ?? hueFor(name);
  return (
    <span className={cx('tf-cursor', `tf-hue--${h}`, isIdle && 'is-idle')} style={{ transform: `translate(${x}px, ${y}px)` }} aria-hidden="true">
      <svg className="tf-cursor__arrow" width="16" height="16" viewBox="0 0 16 16"><path d="M2.5 1.5v12.2l3.4-3.3 2.4 5.1 2.2-1-2.4-5h4.6z" /></svg>
      <span className="tf-cursor__name">{name}</span>
    </span>
  );
}

/** Props for RemoteCaret. */
export interface RemoteCaretProps {
  readonly name: string;
  readonly hue?: Hue;
}

/** Where another person is typing in a shared note: a 2px caret in their hue with their name on a flag above it. */
export function RemoteCaret({ name, hue }: RemoteCaretProps) {
  return (
    <span className={cx('tf-caret', `tf-hue--${hue ?? hueFor(name)}`)} aria-hidden="true">
      <span className="tf-caret__flag">{name}</span>
    </span>
  );
}

/** One person in a PresenceGroup. */
export interface PresencePerson {
  readonly name: string;
  readonly src?: string;
  /** `active` (green dot) is here now; `idle` (yellow) has the page open in the background. */
  readonly status: 'active' | 'idle';
  /** What they are doing, for the tooltip: "Editing Discovery call". */
  readonly activity?: string;
}

/** Props for PresenceGroup. */
export interface PresenceGroupProps {
  readonly people: ReadonlyArray<PresencePerson>;
  /** How many avatars before "+n" (default 4). */
  readonly max?: number;
  readonly size?: 20 | 28 | 36;
}

const LIFT = -4;
const FALLOFF = 0.45;
const SCALE = 1.05;

/** Who else is here: overlapping avatars with live status dots, each named in a Tooltip; the stack springs on hover (transitions.dev 11). */
export function PresenceGroup({ people, max = 4, size = 28 }: PresenceGroupProps) {
  const root = useRef<HTMLDivElement>(null);
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  const lift = (active: number | undefined, phase: 'in' | 'out') => {
    root.current?.querySelectorAll<HTMLElement>('.tf-presence__item').forEach((el, i) => {
      el.style.transitionTimingFunction = phase === 'out' ? 'var(--ease-bounce-strong)' : 'var(--ease-smooth-out)';
      const d = active === undefined ? -1 : Math.abs(i - active);
      el.style.setProperty('--tf-shift', d < 0 ? '0px' : `${(LIFT * FALLOFF ** d).toFixed(3)}px`);
      el.style.setProperty('--tf-lift-scale', d === 0 ? String(SCALE) : '1');
    });
  };
  const label = `${people.filter((p) => p.status === 'active').length} here now: ${people.map((p) => p.name).join(', ')}`;
  return (
    <div ref={root} className="tf-presence" role="group" aria-label={label} style={{ '--tf-av': `${size}px` } as React.CSSProperties} onMouseLeave={() => lift(undefined, 'out')}>
      {shown.map((p, i) => (
        <Tooltip key={p.name} label={`${p.name} · ${p.activity ?? (p.status === 'active' ? 'Here now' : 'Away')}`} placement="bottom">
          <Focusable>
            <span className="tf-presence__item" tabIndex={0} onMouseEnter={() => lift(i, 'in')} onFocus={() => lift(i, 'in')} onBlur={() => lift(undefined, 'out')}>
              <Avatar name={p.name} src={p.src} size={size} status={p.status === 'active' ? 'online' : 'away'} />
            </span>
          </Focusable>
        </Tooltip>
      ))}
      {rest > 0 && <span className="tf-presence__item tf-presence__more" onMouseEnter={() => lift(shown.length, 'in')}>+{rest}</span>}
    </div>
  );
}
