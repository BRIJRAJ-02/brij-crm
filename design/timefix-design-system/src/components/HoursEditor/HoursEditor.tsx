import { DialogTrigger } from 'react-aria-components';
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { Button, IconButton } from '../Button/Button.tsx';
import { Checkbox, Switch } from '../Checkbox/Checkbox.tsx';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import { cx } from '../../lib/cx.ts';
import { formatClockRange } from '../WeekCalendar/clock.ts';
import { Popover } from '../Popover/Popover.tsx';
import { TimeSelect } from '../TimeField/TimeField.tsx';
import './HoursEditor.css';

/** The seven days, Monday first. */
export const HOURS_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
/** A day of the week. */
export type HoursDay = (typeof HOURS_DAYS)[number];
/** One open range, in minutes from midnight. `id` keeps its row steady while it animates. */
export interface HoursRange { readonly id: string; readonly start: number; readonly end: number }
/** A day's availability: on or off, and its ranges (kept while off so turning it back on restores them). */
export interface DayHours { readonly on: boolean; readonly ranges: ReadonlyArray<HoursRange> }
/** A whole week of availability. */
export type WeekHours = Readonly<Record<HoursDay, DayHours>>;

const NAMES: Readonly<Record<HoursDay, string>> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const newId = () => Math.random().toString(36).slice(2, 10);

/** What is wrong with a day's ranges, if anything: an end before its start, or two ranges that overlap. */
export function hoursProblem(day: DayHours): string | undefined {
  if (!day.on) return undefined;
  if (day.ranges.some((r) => r.end <= r.start)) return 'End time must be after the start.';
  const sorted = [...day.ranges].sort((a, b) => a.start - b.start);
  return sorted.some((r, n) => n > 0 && r.start < (sorted[n - 1]?.end ?? 0)) ? 'These times overlap.' : undefined;
}

const short = (d: HoursDay) => NAMES[d].slice(0, 3);
/** "Tue", "Tue and Thu", "Mon, Tue and Thu". */
const listDays = (ds: ReadonlyArray<HoursDay>) => (ds.length < 2 ? ds.map(short).join('') : `${ds.slice(0, -1).map(short).join(', ')} and ${short(ds[ds.length - 1] ?? 'mon')}`);
/** Days as runs: "Mon–Fri", "Mon–Wed, Fri". */
function dayRuns(ds: ReadonlyArray<HoursDay>): string {
  const idx = ds.map((d) => HOURS_DAYS.indexOf(d));
  const runs: string[] = [];
  let a = 0;
  for (let n = 1; n <= idx.length; n += 1) {
    if (n === idx.length || (idx[n] ?? 0) !== (idx[n - 1] ?? 0) + 1) {
      runs.push(n - 1 > a + 1 ? `${short(ds[a] ?? 'mon')}–${short(ds[n - 1] ?? 'mon')}` : ds.slice(a, n).map(short).join(', '));
      a = n;
    }
  }
  return runs.join(', ');
}

/** A one-line human summary for a page header: "Mon–Fri · 9:00 AM – 5:00 PM, with changes on Tue and Thu". */
export function summarizeHours(week: WeekHours, hour12 = true): string {
  const on = HOURS_DAYS.filter((d) => week[d].on && week[d].ranges.length > 0);
  if (on.length === 0) return 'Unavailable all week';
  const sig = (d: HoursDay) => week[d].ranges.map((r) => formatClockRange(r.start, r.end, hour12)).join(', ');
  // The usual hours are the ones most days share; the rest are "changes".
  const counts = new Map<string, number>();
  on.forEach((d) => counts.set(sig(d), (counts.get(sig(d)) ?? 0) + 1));
  const usual = [...counts].sort((x, y) => y[1] - x[1])[0]?.[0] ?? '';
  const changed = on.filter((d) => sig(d) !== usual);
  return `${dayRuns(on)} · ${usual}${changed.length ? `, with changes on ${listDays(changed)}` : ''}`;
}

/** The week's problem in one phrase ("Thu has overlapping times"), or undefined when every day is fine. */
export function summarizeHoursProblem(week: WeekHours): string | undefined {
  const bad = HOURS_DAYS.filter((d) => hoursProblem(week[d]) !== undefined);
  if (bad.length === 0) return undefined;
  const overlap = bad.every((d) => hoursProblem(week[d]) === 'These times overlap.');
  const verb = bad.length === 1 ? 'has' : 'have';
  return overlap ? `${listDays(bad)} ${verb} overlapping times` : `${listDays(bad)} ${verb} times that need fixing`;
}

/** The summary line under a "Working hours" title: one line that truncates, the problem (if any) in red after it. */
export function HoursSummary({ value, hour12 = true }: { readonly value: WeekHours; readonly hour12?: boolean }) {
  const problem = summarizeHoursProblem(value);
  return (
    <p className="tf-hours__summary tf-num" title={summarizeHours(value, hour12)}>
      {summarizeHours(value, hour12)}
      {problem && <> · <span className="tf-hours__summary-problem">{problem}</span></>}
    </p>
  );
}

const cssMs = (name: string, fallback: number) => {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
};

/** Minutes from midnight as the shared TimeSelect's "HH:MM", and back. */
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const fromHHMM = (v: string) => { const [h = 0, m = 0] = v.split(':').map(Number); return h * 60 + m; };

/** "Copy times to…": a popover of day checkboxes and Apply. */
function CopyTo({ from, onApply }: { readonly from: HoursDay; readonly onApply: (days: ReadonlyArray<HoursDay>) => void }) {
  const [picked, setPicked] = useState<ReadonlySet<HoursDay>>(new Set());
  const all = HOURS_DAYS.filter((d) => d !== from);
  const [open, setOpen] = useState(false);
  return (
    <DialogTrigger isOpen={open} onOpenChange={(o) => { setOpen(o); if (o) setPicked(new Set()); }}>
      <Tooltip label="Copy times to…"><IconButton label={`Copy ${NAMES[from]}'s times to other days`} size="sm"><Copy size={14} strokeWidth={1.75} /></IconButton></Tooltip>
      <Popover label={`Copy ${NAMES[from]}'s times to`} placement="bottom end" offset={6} className="tf-hours__copy-pop">
        <div className="tf-hours__copy">
          <p className="tf-hours__copy-title">Copy times to</p>
          <Checkbox isSelected={picked.size === all.length} isIndeterminate={picked.size > 0 && picked.size < all.length}
            onChange={(v) => setPicked(new Set(v ? all : []))}>Every day</Checkbox>
          <span className="tf-hours__copy-rule" />
          {HOURS_DAYS.map((d) => (
            <Checkbox key={d} isDisabled={d === from} isSelected={d === from || picked.has(d)}
              onChange={(v) => setPicked((s) => { const n = new Set(s); if (v) n.add(d); else n.delete(d); return n; })}>{NAMES[d]}</Checkbox>
          ))}
          <Button size="sm" variant="primary" className="tf-hours__apply" isDisabled={picked.size === 0} onPress={() => { onApply([...picked]); setOpen(false); }}>Apply</Button>
        </div>
      </Popover>
    </DialogTrigger>
  );
}

/** Props for HoursEditor. */
export interface HoursEditorProps {
  readonly value: WeekHours;
  readonly onChange: (next: WeekHours) => void;
  readonly hour12?: boolean;
}

/** Weekly availability: a row per day with a switch, split ranges, add and remove, copy to other days, and overlap checks. */
export function HoursEditor({ value, onChange, hour12 = true }: HoursEditorProps) {
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [washed, setWashed] = useState<ReadonlySet<HoursDay>>(new Set());
  const rows = useRef<Partial<Record<HoursDay, HTMLDivElement | null>>>({});

  const setDay = (d: HoursDay, next: DayHours) => {
    const prevProblem = hoursProblem(value[d]);
    const problem = hoursProblem(next);
    onChange({ ...value, [d]: next });
    const el = rows.current[d];
    if (problem && problem !== prevProblem && el) {
      // 12 error state shake: replay from a clean baseline.
      el.classList.remove('is-shaking');
      void el.offsetWidth;
      el.classList.add('is-shaking');
    }
  };
  const add = (d: HoursDay) => {
    const last = value[d].ranges[value[d].ranges.length - 1];
    const start = Math.min((last?.end ?? 9 * 60) + 60, 22 * 60);
    const r = { id: newId(), start, end: Math.min(start + 120, 23 * 60 + 45) };
    setFresh(new Set([r.id]));
    setDay(d, { ...value[d], ranges: [...value[d].ranges, r] });
  };
  const remove = (d: HoursDay, id: string) => {
    setLeaving((s) => new Set(s).add(id));
    window.setTimeout(() => {
      setLeaving((s) => { const n = new Set(s); n.delete(id); return n; });
      onChange({ ...value, [d]: { ...value[d], ranges: value[d].ranges.filter((r) => r.id !== id) } });
    }, cssMs('--duration-fast', 250));
  };
  const toggle = (d: HoursDay, on: boolean) => setDay(d, { on, ranges: on && value[d].ranges.length === 0 ? [{ id: newId(), start: 9 * 60, end: 17 * 60 }] : value[d].ranges });
  const copy = (from: HoursDay, to: ReadonlyArray<HoursDay>) => {
    const next = { ...value };
    to.forEach((d) => { next[d] = { on: true, ranges: value[from].ranges.map((r) => ({ ...r, id: newId() })) }; });
    onChange(next);
    setWashed(new Set(to));
    window.setTimeout(() => setWashed(new Set()), cssMs('--duration-very-slow', 500) * 2);
  };

  return (
    <div className="tf-hours" role="group" aria-label="Weekly hours">
      {HOURS_DAYS.map((d) => {
        const day = value[d];
        const problem = hoursProblem(day);
        return (
          <div key={d} className={cx('tf-hours__row', !day.on && 'tf-hours__row--off', washed.has(d) && 'is-washed')}>
            <div className="tf-hours__day"><Switch isSelected={day.on} onChange={(v) => toggle(d, v)}>{NAMES[d]}</Switch></div>
            <div className="tf-hours__ranges" ref={(el) => { rows.current[d] = el; }}>
              <OnOffSwap on={day.on}>{(mounted) => (day.on ? <SwapLayer key="on" mounted={mounted}>{day.ranges.map((r, n) => (
                <div key={r.id} className={cx('tf-hours__range-wrap', fresh.has(r.id) && 'is-new', leaving.has(r.id) && 'is-leaving')}>
                  <div className="tf-hours__range-clip">
                    <div className="tf-hours__range">
                      <TimeSelect label={`${NAMES[d]} range ${n + 1} start`} isLabelHidden value={toHHMM(r.start)} hourCycle={hour12 ? 12 : 24} isInvalid={problem !== undefined}
                        onChange={(v) => { if (v !== null) { const start = fromHHMM(v); setDay(d, { ...day, ranges: day.ranges.map((x) => (x.id === r.id ? { ...x, start } : x)) }); } }} />
                      <span className="tf-hours__dash" aria-hidden="true">–</span>
                      <TimeSelect label={`${NAMES[d]} range ${n + 1} end`} isLabelHidden value={toHHMM(r.end)} hourCycle={hour12 ? 12 : 24} isInvalid={problem !== undefined}
                        onChange={(v) => { if (v !== null) { const end = fromHHMM(v); setDay(d, { ...day, ranges: day.ranges.map((x) => (x.id === r.id ? { ...x, end } : x)) }); } }} />
                      {n === 0 ? (
                        <span className="tf-hours__tools">
                          <Tooltip label="Add a range"><IconButton label={`Add a range on ${NAMES[d]}`} size="sm" onPress={() => add(d)}><Plus size={14} strokeWidth={1.75} /></IconButton></Tooltip>
                          <CopyTo from={d} onApply={(to) => copy(d, to)} />
                        </span>
                      ) : (
                        <span className="tf-hours__tools">
                          <Tooltip label="Remove range"><IconButton label={`Remove ${NAMES[d]} range ${n + 1}`} size="sm" onPress={() => remove(d, r.id)}><Trash2 size={14} strokeWidth={1.75} /></IconButton></Tooltip>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}</SwapLayer> : <SwapLayer key="off" mounted={mounted}><span className="tf-hours__off">Unavailable</span></SwapLayer>)}</OnOffSwap>
              <div className={cx('tf-hours__error', problem && 'is-shown')} role="status"><span className="tf-hours__error-text">{problem ?? ''}</span></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A day's ranges or "Unavailable": when the switch flips, the row's height glides between them (transitions.dev 01 card resize) and the new side fades in. */
function OnOffSwap({ on, children }: { readonly on: boolean; readonly children: (mounted: RefObject<boolean>) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const last = useRef<{ readonly on: boolean; readonly h: number } | undefined>(undefined);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const prev = last.current;
    last.current = { on, h };
    mounted.current = true;
    if (!prev || prev.on === on || prev.h === h || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cs = getComputedStyle(el);
    el.animate([{ height: `${prev.h}px` }, { height: `${h}px` }], {
      duration: Number.parseFloat(cs.getPropertyValue('--duration-fast')) || 250,
      easing: cs.getPropertyValue('--ease-smooth-out').trim() || 'ease-out',
    });
  });
  return <div ref={ref} className="tf-hours__swap">{children(mounted)}</div>;
}

/** One side of the swap; it fades in only when it replaces the other side, never on first load. */
function SwapLayer({ mounted, children }: { readonly mounted: RefObject<boolean>; readonly children: ReactNode }) {
  const [enters] = useState(() => mounted.current === true);
  return <div className={cx('tf-hours__layer', enters && 'is-entering')}>{children}</div>;
}
