import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Focusable, Separator as AriaSeparator, VisuallyHidden as AriaVisuallyHidden } from 'react-aria-components';
import { ChevronRight } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import { formatClock } from '../WeekCalendar/clock.ts';
import { SoftText } from '../Motion/Motion.tsx';
import './Text.css';

/** Props for VisuallyHidden. */
export interface VisuallyHiddenProps {
  readonly children: ReactNode;
  /** Shows what it holds while focus is inside it: a skip link. */
  readonly isFocusable?: boolean;
  /** So a control can point at it with `aria-describedby`. */
  readonly id?: string;
  /** A `span` for words inside a line (a link's "(opens in a new tab)"); a `div` otherwise. */
  readonly isInline?: boolean;
}

/** Text for screen readers only: in the page and read aloud, taking no space on screen. */
export function VisuallyHidden({ children, isFocusable = false, id, isInline = false }: VisuallyHiddenProps) {
  return <AriaVisuallyHidden isFocusable={isFocusable} id={id} elementType={isInline ? 'span' : 'div'}>{children}</AriaVisuallyHidden>;
}

/** Props for Separator. */
export interface SeparatorProps {
  /** `horizontal` between stacked groups, `vertical` between toolbar groups. */
  readonly orientation?: 'horizontal' | 'vertical';
  /** A word between two hairlines, across only: "or" between Continue with Google and the email field. */
  readonly label?: string;
}

/** A hairline between groups, announced as a separator; with `label`, a word between two hairlines read in place. */
export function Separator({ orientation = 'horizontal', label }: SeparatorProps) {
  if (label !== undefined) return <div className="tf-sep-label"><span>{label}</span></div>;
  return <AriaSeparator orientation={orientation} className={cx('tf-sep', `tf-sep--${orientation}`)} />;
}

/** Props for Path. */
export interface PathProps {
  /** The attributes in order, through relations: `['Company', 'Owner', 'Email']`. */
  readonly parts: ReadonlyArray<string>;
}

/** An attribute path through relations, Company › Owner › Email, for filters, formulas and variables. Heard as "Company, then Owner". */
export function Path({ parts }: PathProps) {
  return (
    <span className="tf-path">
      {parts.map((part, i) => (
        <Fragment key={`${i}-${part}`}>
          {i > 0 && <><ChevronRight className="tf-path__sep" size={12} strokeWidth={1.75} aria-hidden="true" /><VisuallyHidden isInline>, then </VisuallyHidden></>}
          <span className="tf-path__part">{part}</span>
        </Fragment>
      ))}
    </span>
  );
}

/** Props for TruncatedText. */
export interface TruncatedTextProps {
  readonly children: string;
  /** 1 (default) or 2 lines before the ellipsis. */
  readonly lines?: 1 | 2;
  /** Tabular figures, for amounts in a column. */
  readonly isNumeric?: boolean;
}

/** Text cut with an ellipsis when it doesn't fit; only then does it take focus and show the full text in a Tooltip. */
export function TruncatedText({ children, lines = 1, isNumeric = false }: TruncatedTextProps) {
  const [el, setEl] = useState<HTMLSpanElement | null>(null);
  const [isCut, setCut] = useState(false);
  useEffect(() => {
    if (!el) return undefined;
    const measure = () => setCut(el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, children]);
  const text = (
    <span ref={setEl} className={cx('tf-trunc', lines === 2 && 'tf-trunc--2', isNumeric && 'tf-num')} tabIndex={isCut ? 0 : undefined}>
      {children}
    </span>
  );
  if (!isCut) return text;
  return <Tooltip label={children}><Focusable>{text}</Focusable></Tooltip>;
}

/** A shared clock: re-renders every `everyMs` (default 30s) so relative times stay current. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(t);
  }, [everyMs]);
  return now;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "just now", "5 min ago", "3 hours ago", "Yesterday", "4 days ago", then the date ("8 Oct", "8 Oct 2025"). Future moments read "in 5 min". */
export function formatRelative(at: Date, now: number): string {
  const diff = now - at.getTime();
  const abs = Math.abs(diff);
  const ago = (n: number, unit: string) => (diff >= 0 ? `${n} ${unit} ago` : `in ${n} ${unit}`);
  if (abs < 45_000) return 'just now';
  const min = Math.round(abs / 60_000);
  if (min < 60) return ago(min, 'min');
  const hr = Math.round(abs / 3_600_000);
  if (hr < 24) return ago(hr, hr === 1 ? 'hour' : 'hours');
  const day = Math.round(abs / 86_400_000);
  if (day === 1) return diff >= 0 ? 'Yesterday' : 'Tomorrow';
  if (day < 7) return ago(day, 'days');
  const sameYear = at.getFullYear() === new Date(now).getFullYear();
  return `${at.getDate()} ${MONTHS[at.getMonth()]}${sameYear ? '' : ` ${at.getFullYear()}`}`;
}

/** The exact moment for a tooltip: "Mon 9 Nov 2026, 9:30 AM", through the one time formatter. */
export function formatExact(at: Date, hour12 = true): string {
  return `${DAYS[at.getDay()]} ${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()}, ${formatClock(at.getHours() * 60 + at.getMinutes(), hour12)}`;
}

/** Props for RelativeTime. */
export interface RelativeTimeProps {
  /** The instant: a Date, an ISO string or epoch milliseconds. */
  readonly value: Date | string | number;
  /** The current time; leave it out to use a live clock that ticks every 30 seconds. */
  readonly now?: number;
  readonly hour12?: boolean;
}

/** A moment as "2 min ago", kept current; the value cross-blurs as it ticks over, and the exact time is in a Tooltip and read after it. */
export function RelativeTime({ value, now, hour12 = true }: RelativeTimeProps) {
  const live = useNow();
  const at = value instanceof Date ? value : new Date(value);
  const exact = formatExact(at, hour12);
  return (
    <Tooltip label={exact}>
      <Focusable>
        <time className="tf-reltime" dateTime={at.toISOString()} tabIndex={0}>
          <SoftText>{formatRelative(at, now ?? live)}</SoftText>
          <VisuallyHidden isInline>, {exact}</VisuallyHidden>
        </time>
      </Focusable>
    </Tooltip>
  );
}
