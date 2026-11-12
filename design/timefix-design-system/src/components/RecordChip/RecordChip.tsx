import { Button as AriaButton, Link } from 'react-aria-components';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Globe } from 'lucide-react';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import { cx } from '../../lib/cx.ts';
import './RecordChip.css';

/** Props for RecordChip. A chip links when it has `href`, presses when it has `onPress`, and is plain text otherwise. */
export interface RecordChipProps {
  readonly name: string;
  /** People get a round avatar, companies and other records a square one. */
  readonly kind?: 'person' | 'company';
  readonly src?: string;
  readonly href?: string;
  readonly onPress?: () => void;
}

/** A record reference as a pill: avatar and name. The one way a linked record shows in cells, panels, cards and text. */
export function RecordChip({ name, kind = 'person', src, href, onPress }: RecordChipProps) {
  const body = (
    <>
      <Avatar name={name} src={src} size={20} shape={kind === 'person' ? 'round' : 'square'} />
      <span className="tf-recordchip__name">{name}</span>
    </>
  );
  if (href) return <Link href={href} className="tf-recordchip tf-recordchip--live">{body}</Link>;
  if (onPress) return <AriaButton onPress={onPress} className="tf-recordchip tf-recordchip--live">{body}</AriaButton>;
  return <span className="tf-recordchip">{body}</span>;
}

/** A website, without a favicon: a globe and the bare domain, opening in a new tab. */
export function LinkChip({ href, children }: { readonly href: string; readonly children?: ReactNode }) {
  const domain = href.replace(/^[a-z]+:\/\//i, '').replace(/^www\./, '').replace(/\/$/, '');
  return (
    <Link href={href} target="_blank" rel="noopener noreferrer" className="tf-recordchip tf-recordchip--live tf-recordchip--link">
      <Globe size={14} strokeWidth={1.75} className="tf-recordchip__globe" aria-hidden="true" />
      <span className="tf-recordchip__name">{children ?? domain}</span>
    </Link>
  );
}

/** An @mention of a member inside running text. `isSelf` marks a mention of the person reading. */
export function Mention({ name, href, isSelf = false }: { readonly name: string; readonly href?: string; readonly isSelf?: boolean }) {
  const body = <><span className="tf-recordchip-mention__at" aria-hidden="true">@</span>{name}</>;
  const cls = cx('tf-recordchip-mention', isSelf && 'tf-recordchip-mention--self');
  return href ? <Link href={href} className={cx(cls, 'tf-recordchip-mention--live')} aria-label={`Mention of ${name}`}>{body}</Link> : <span className={cls}>{body}</span>;
}

/** A merge variable in a template ({{first name}}). `isMissing` turns it orange: this record has no value, so the message would send a gap. */
export function Variable({ name, isMissing = false }: { readonly name: string; readonly isMissing?: boolean }) {
  return (
    <span className={cx('tf-var', isMissing && 'tf-var--missing')}>
      <span className="tf-var__brace" aria-hidden="true">{'{{'}</span>{name}<span className="tf-var__brace" aria-hidden="true">{'}}'}</span>
      {isMissing && <span className="tf-sr-only">, no value for this record</span>}
    </span>
  );
}

/** One entry of a RecordChipList. */
export interface ChipRecord extends RecordChipProps {
  readonly id: string;
}

const LIFT = -4; // transitions.dev 11 --avatar-lift (distance-micro)
const FALLOFF = 0.45;
const SCALE = 1.05;

/** Records as chips in a row: past `max` a "+n" chip names the rest. Hovering lifts a chip and nudges its neighbours, then springs back (transitions.dev 11 avatar group hover). */
export function RecordChipList({ label, records, max = 4 }: { readonly label: string; readonly records: ReadonlyArray<ChipRecord>; readonly max?: number }) {
  const [hover, setHover] = useState<{ readonly index?: number; readonly phase: 'in' | 'out' }>({ phase: 'out' });
  const shown = records.slice(0, max);
  const rest = records.slice(max);
  const count = shown.length + (rest.length > 0 ? 1 : 0);
  const styleFor = (i: number): CSSProperties => {
    const d = hover.index === undefined ? undefined : Math.abs(i - hover.index);
    return {
      '--tf-shift': d === undefined ? '0px' : `${(LIFT * FALLOFF ** d).toFixed(3)}px`,
      '--tf-scale': d === 0 ? String(SCALE) : '1',
      transitionTimingFunction: hover.phase === 'out' ? 'var(--ease-bounce-strong)' : 'var(--ease-smooth-out)',
    } as CSSProperties;
  };
  return (
    <ul className="tf-rchips" aria-label={label} onMouseLeave={() => setHover({ phase: 'out' })}>
      {shown.map((r, i) => (
        <li key={r.id} className="tf-rchips__item" style={styleFor(i)} onMouseEnter={() => setHover({ index: i, phase: 'in' })}>
          <RecordChip name={r.name} kind={r.kind} src={r.src} href={r.href} onPress={r.onPress} />
        </li>
      ))}
      {rest.length > 0 && (
        <li className="tf-rchips__item" style={styleFor(count - 1)} onMouseEnter={() => setHover({ index: count - 1, phase: 'in' })}>
          <Tooltip label={rest.map((r) => r.name).join(', ')}>
            <AriaButton className="tf-recordchip tf-recordchip--live tf-recordchip--more" aria-label={`${rest.length} more: ${rest.map((r) => r.name).join(', ')}`}>+{rest.length}</AriaButton>
          </Tooltip>
        </li>
      )}
    </ul>
  );
}
