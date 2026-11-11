import { ToggleButton, ToggleButtonGroup } from 'react-aria-components';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { StatusDot, type Hue } from '../Tag/Tag.tsx';
import { cx } from '../../lib/cx.ts';
import { bezier } from '../../lib/bezier.ts';
import { SoftText } from '../Motion/Motion.tsx';
import './Chart.css';

/* ---------- motion helpers (tokens read at run time, so a theme's values apply) ---------- */

function token(name: string, el?: Element | null): string {
  return getComputedStyle(el ?? document.documentElement).getPropertyValue(name).trim();
}
function ms(name: string, fallback: number, el?: Element | null): number {
  const v = parseFloat(token(name, el));
  return Number.isFinite(v) ? v : fallback;
}
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Eases every number from its old value to its new one (transitions.dev 35's morph: duration-slow, ease-smooth-out). */
function useTween(target: ReadonlyArray<number> | undefined, el?: Element | null): ReadonlyArray<number> | undefined {
  const [current, setCurrent] = useState(target);
  const last = useRef(target);
  const key = target?.join(',');
  useEffect(() => {
    const from = last.current;
    if (!target || !from || from.length !== target.length || reduced()) {
      last.current = target;
      setCurrent(target);
      return undefined;
    }
    const dur = ms('--duration-slow', 400, el);
    const ease = bezier(token('--ease-smooth-out', el), 'cubic-bezier(0.22, 1, 0.36, 1)');
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = ease(t);
      const v = from.map((f, k) => f + ((target[k] ?? 0) - f) * e);
      last.current = v;
      setCurrent(v);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // Until the first frame of a tween runs, a new data set of another length draws as it is.
  return current && target && current.length === target.length ? current : target;
}

function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/* ---------- Stat, PeriodSwitch, ChartCard ---------- */

/** A Mercury-style figure: 13px label, the number, a grey delta line. No value shows "—" and keeps the layout. */
export function Stat({ label, value, delta, trend, children }: { readonly label: string; readonly value?: string; readonly delta?: string; readonly trend?: 'up' | 'down'; readonly children?: ReactNode }) {
  return (
    <div className="tf-chart-stat">
      <span className="tf-chart-stat__label">{label}</span>
      <span className="tf-chart-stat__value">{value === undefined ? <span className="tf-chart__dash">—</span> : <SoftText>{value}</SoftText>}</span>
      <span className="tf-chart-stat__delta">
        {delta !== undefined && trend === 'up' && <TrendingUp size={14} strokeWidth={1.75} className="tf-chart-stat__up" aria-label="Up" />}
        {delta !== undefined && trend === 'down' && <TrendingDown size={14} strokeWidth={1.75} className="tf-chart-stat__down" aria-label="Down" />}
        {delta === undefined ? '—' : <SoftText>{delta}</SoftText>}
      </span>
      {children}
    </div>
  );
}

/** Week, month, quarter: one choice that recomputes the charts beside it. */
export function PeriodSwitch({ label, value, options, onChange }: { readonly label: string; readonly value: string; readonly options: ReadonlyArray<{ readonly id: string; readonly label: string }>; readonly onChange: (id: string) => void }) {
  return (
    <ToggleButtonGroup aria-label={label} selectionMode="single" disallowEmptySelection selectedKeys={[value]} className="tf-period"
      onSelectionChange={(keys) => { const k = [...keys][0]; if (k !== undefined) onChange(String(k)); }}>
      {options.map((o) => <ToggleButton key={o.id} id={o.id} className="tf-period__item">{o.label}</ToggleButton>)}
    </ToggleButtonGroup>
  );
}

/** A white card around one chart: a title and an optional action on the right. */
export function ChartCard({ title, action, children }: { readonly title: string; readonly action?: ReactNode; readonly children: ReactNode }) {
  return (
    <section className="tf-chart-card" aria-label={title}>
      <header className="tf-chart-card__head"><h3 className="tf-chart-card__title">{title}</h3>{action}</header>
      {children}
    </section>
  );
}

/* ---------- BarChart ---------- */

/** One bar or row: a label, a value and the value in words. */
export interface ChartPoint {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly valueText?: string;
}

const GHOST = [0.35, 0.6, 0.45, 0.8, 0.55, 0.7, 0.4, 0.5, 0.65, 0.3, 0.75, 0.5];
const R = 4; // radius-xs: rounded data ends, square feet

function barPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return '';
  const r = Math.min(R, w / 2, h);
  return `M${x} ${y + h}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h}Z`;
}

/** Bars per period or group (BarStrip). Points undefined draws Mercury's dotted placeholder; hover or focus a bar for its value.
 *  `look="dots"` stacks one dot per step instead of a bar (the marketing site's dot columns), for counts over time; each change
 *  fades the columns in left to right, 12ms apart. */
export function BarChart({ label, points, height = 168, ghostCount = 7, emptyText, look = 'bars' }: { readonly label: string; readonly points?: ReadonlyArray<ChartPoint>; readonly height?: number; readonly ghostCount?: number; readonly emptyText?: string; readonly look?: 'bars' | 'dots' | 'line' }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | undefined>(undefined);
  const plotH = height - 24;
  const real = points !== undefined && points.length > 0;
  const n = real ? points.length : ghostCount;
  const slot = width / Math.max(1, n);
  const bw = Math.min(24, slot * 0.56);
  const max = real ? Math.max(1, ...points.map((p) => p.value)) : 1;
  const heights = useTween(real ? points.map((p) => (p.value / max) * (plotH - 8)) : undefined, ref.current);
  const showEvery = Math.max(1, Math.ceil(56 / Math.max(1, slot)));
  // Dots: one pitch per step, as wide as a column allows (6 to 12px), so the tallest column fills the plot.
  const pitch = Math.max(6, Math.min(12, slot * 0.8));
  const rows = Math.max(1, Math.floor((plotH - 4) / pitch));
  const dotsOf = (v: number) => (v <= 0 ? 0 : Math.max(1, Math.round((v / max) * rows)));
  const runKey = real ? points.map((p) => p.value).join(',') : '';
  const a = active !== undefined && real ? points[active] : undefined;
  return (
    <div ref={ref} className="tf-chart" style={{ height }} aria-busy={points === undefined || undefined}>
      {width > 0 && (
        <svg width={width} height={height} role="list" aria-label={label} className="tf-chart__svg">
          {!(look === 'dots' && real) && <line x1={0} x2={width} y1={plotH + 0.5} y2={plotH + 0.5} className="tf-chart__base" />}
          {look === 'line' && real && heights && <polyline className="tf-chart__line" points={heights.map((hh, i) => `${i * slot + slot / 2},${plotH - hh}`).join(' ')} />}
          {Array.from({ length: n }, (_, i) => {
            const x = i * slot + (slot - bw) / 2;
            const p = real ? points[i] : undefined;
            const h = real ? heights?.[i] ?? 0 : (GHOST[i % GHOST.length] ?? 0.5) * (plotH - 8);
            return (
              <g key={p?.id ?? i} role="listitem">
                {look === 'dots' && p
                  ? <g key={runKey} className={cx('tf-chart__dots', active !== undefined && active !== i && 'is-dim')} style={{ '--i': i } as CSSProperties}>
                    {dotsOf(p.value) === 0 ? <circle cx={i * slot + slot / 2} cy={plotH - pitch / 2} r={pitch * 0.3} className="tf-chart__dot-off" />
                      : Array.from({ length: dotsOf(p.value) }, (_, r) => <circle key={r} cx={i * slot + slot / 2} cy={plotH - pitch / 2 - r * pitch} r={pitch * 0.3} />)}
                  </g>
                  : look === 'line' && p ? <circle cx={i * slot + slot / 2} cy={plotH - h} r={active === i ? 5 : 3.5} className={cx('tf-chart__point', active !== undefined && active !== i && 'is-dim')} />
                  : <path d={barPath(x, plotH - h, bw, h)} className={cx(real ? 'tf-chart__bar' : 'tf-chart__ghost', active !== undefined && active !== i && 'is-dim')} />}
                {p && (
                  <rect x={i * slot} y={0} width={slot} height={plotH} className="tf-chart__hit" tabIndex={0} aria-label={`${p.label}: ${p.valueText ?? p.value}`}
                    onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(undefined)} onFocus={() => setActive(i)} onBlur={() => setActive(undefined)} />
                )}
                {p && i % showEvery === 0 && <text x={i * slot + slot / 2} y={height - 6} textAnchor="middle" className="tf-chart__tick" aria-hidden="true">{p.label}</text>}
              </g>
            );
          })}
        </svg>
      )}
      {points !== undefined && points.length === 0 && emptyText && <p className="tf-chart__empty">{emptyText}</p>}
      {a && active !== undefined && (
        <div key={active} className="tf-chart__tip" role="presentation"
          style={{ left: active * slot + slot / 2, top: plotH - (look === 'dots' ? dotsOf(a.value) * pitch : heights?.[active] ?? 0) - 8 }}>
          <span className="tf-chart__tiplabel">{a.label}</span>{a.valueText ?? a.value.toLocaleString('en-US')}
        </div>
      )}
    </div>
  );
}

/* ---------- Sparkline ---------- */

/** A small line of a trend beside a figure: 1.5px line, a 10% wash, an end dot. No values draws a dotted placeholder. */
export function Sparkline({ label, values, height = 40 }: { readonly label: string; readonly values?: ReadonlyArray<number>; readonly height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const lo = values ? Math.min(...values) : 0;
  const hi = values ? Math.max(...values) : 1;
  const ys = useTween(values?.map((v) => 4 + (1 - (v - lo) / Math.max(1, hi - lo)) * (height - 8)), ref.current);
  const pts = (ys ?? [0.6, 0.45, 0.55, 0.35, 0.5, 0.3, 0.4].map((f) => f * height)).map((y, i, arr) => [3 + (i / Math.max(1, arr.length - 1)) * (width - 6), y] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  const end = pts[pts.length - 1];
  return (
    <div ref={ref} className="tf-spark" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={values ? `${label}: ${values.join(', ')}` : `${label}: loading`}>
          {ys ? (
            <>
              <path d={`${line}L${width - 3} ${height}L3 ${height}Z`} className="tf-spark__wash" />
              <path d={line} className="tf-spark__line" strokeWidth={1.5} />
              {end && <circle cx={end[0]} cy={end[1]} r={3} className="tf-spark__dot" strokeWidth={2} />}
            </>
          ) : (
            <path d={line} className="tf-spark__ghost" strokeWidth={1.5} />
          )}
        </svg>
      )}
    </div>
  );
}

/* ---------- DonutChart: transitions.dev 35 ---------- */

/** One share of a DonutChart. Keep the order fixed across data sets so each segment morphs into its own new share. `track` is the grey "Remaining" share of a limit (plan usage). */
export interface DonutSegment {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly hue: Hue | 'track';
  readonly valueText?: string;
}

const GAP = 3; // transitions.dev 35 --chart-gap
const CORNER = 2; // --chart-corner: the round-joined stroke rounds each corner

function ringPath(c: number, ro: number, ri: number, a0: number, a1: number): string {
  const Ro = ro - CORNER, Ri = ri + CORNER, h = GAP / 2 + CORNER;
  if (Ro <= Ri) return '';
  const dO = Math.asin(Math.min(1, h / Ro)), dI = Math.asin(Math.min(1, h / Ri));
  const o0 = a0 + dO, o1 = a1 - dO, i0 = a0 + dI, i1 = a1 - dI;
  if (i1 - i0 <= 0 || o1 - o0 <= 0) return '';
  const pt = (r: number, a: number) => `${(c + r * Math.sin(a)).toFixed(3)} ${(c - r * Math.cos(a)).toFixed(3)}`;
  const lo = o1 - o0 > Math.PI ? 1 : 0, li = i1 - i0 > Math.PI ? 1 : 0;
  return `M${pt(Ro, o0)}A${Ro} ${Ro} 0 ${lo} 1 ${pt(Ro, o1)}L${pt(Ri, i1)}A${Ri} ${Ri} 0 ${li} 0 ${pt(Ri, i0)}Z`;
}

const segColor = (s: DonutSegment) => (s.hue === 'track' ? 'var(--surface-selected)' : `var(--dot-${s.hue})`);

/** A ring of shares with even gaps and soft corners that morphs to new values, a total in the middle and a legend whose rows dim the others on hover. */
export function DonutChart({ label, segments, total, totalLabel = 'Total', size = 140, thickness = 14 }: {
  readonly label: string; readonly segments?: ReadonlyArray<DonutSegment>; readonly total?: string; readonly totalLabel?: string; readonly size?: number; readonly thickness?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<string | undefined>(undefined);
  const values = useTween(segments?.map((s) => s.value), ref.current);
  const sum = (segments ?? []).reduce((acc, s) => acc + s.value, 0);
  const c = size / 2, ro = c, ri = ro - thickness;
  let angle = 0;
  const tweenSum = (values ?? []).reduce((acc, v) => acc + v, 0) || 1;
  return (
    <div className="tf-donut" ref={ref}>
      <div className="tf-donut__ring" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={segments ? `${label}: ${segments.map((s) => `${s.label} ${s.valueText ?? s.value}`).join(', ')}` : `${label}: loading`}>
          {segments && values ? segments.map((s, k) => {
            const span = ((values[k] ?? 0) / tweenSum) * Math.PI * 2;
            const d = ringPath(c, ro, ri, angle, angle + span);
            angle += span;
            return <path key={s.id} d={d} className={cx('tf-donut__seg', hover !== undefined && hover !== s.id && 'is-dim')} style={{ fill: segColor(s), stroke: segColor(s), strokeWidth: CORNER * 2 }} />;
          }) : (
            <circle cx={c} cy={c} r={ro - thickness / 2} className="tf-donut__ghost" strokeWidth={thickness - 2} />
          )}
        </svg>
        <div className="tf-donut__center">
          <span className="tf-donut__total">{total === undefined ? '—' : <SoftText align="center">{total}</SoftText>}</span>
          <span className="tf-donut__caption">{totalLabel}</span>
        </div>
      </div>
      <ul className="tf-donut__legend" aria-label={`${label} legend`}>
        {(segments ?? []).map((s) => (
          <li key={s.id} className={cx('tf-donut__row', hover !== undefined && hover !== s.id && 'is-dim')} tabIndex={0}
            onPointerEnter={() => setHover(s.id)} onPointerLeave={() => setHover(undefined)} onFocus={() => setHover(s.id)} onBlur={() => setHover(undefined)}>
            {s.hue === 'track' ? <span className="tf-donut__name"><span className="tf-donut__trackdot" aria-hidden="true" />{s.label}</span> : <StatusDot hue={s.hue}>{s.label}</StatusDot>}
            <span className="tf-donut__value"><SoftText align="end">{s.valueText ?? s.value.toLocaleString('en-US')}</SoftText></span>
            <span className="tf-donut__share"><SoftText align="end">{sum ? `${Math.round((s.value / sum) * 100)}%` : '—'}</SoftText></span>
          </li>
        ))}
        {!segments && [0, 1, 2].map((i) => <li key={i} className="tf-donut__row tf-donut__row--ghost"><span className="tf-chart__ghostline" /><span>—</span></li>)}
      </ul>
    </div>
  );
}

/* ---------- BarList ---------- */

/** Mercury's breakdown rows: a label, a thin inline bar of its share, the value and share on the right. */
export function BarList({ label, items }: { readonly label: string; readonly items?: ReadonlyArray<ChartPoint> }) {
  const max = items ? Math.max(1, ...items.map((i) => i.value)) : 1;
  const sum = items ? items.reduce((a, i) => a + i.value, 0) : 0;
  return (
    <ul className="tf-barlist" aria-label={label} aria-busy={items === undefined || undefined}>
      {(items ?? [undefined, undefined, undefined]).map((it, k) => (
        <li key={it?.id ?? k} className="tf-barlist__row">
          <span className="tf-barlist__label">{it?.label ?? <span className="tf-chart__ghostline" />}</span>
          <span className="tf-barlist__value">{it ? <SoftText align="end">{it.valueText ?? it.value.toLocaleString('en-US')}</SoftText> : '—'}</span>
          <span className="tf-barlist__share">{it && sum ? <SoftText align="end">{`${Math.round((it.value / sum) * 100)}%`}</SoftText> : '—'}</span>
          <span className={cx('tf-barlist__track', !it && 'tf-barlist__track--ghost')} aria-hidden="true">
            {it && <span className="tf-barlist__fill" style={{ width: `${(it.value / max) * 100}%` }} />}
          </span>
        </li>
      ))}
    </ul>
  );
}
