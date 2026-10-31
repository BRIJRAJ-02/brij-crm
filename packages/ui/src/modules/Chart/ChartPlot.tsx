import { useState, type PointerEvent } from 'react';
import '../../lib/custom-properties.ts';
import {
  areaPath,
  barPath,
  barSlot,
  charsThatFit,
  cutLabel,
  labelStep,
  linePath,
  nearestIndex,
  niceTicks,
} from './chart-math.ts';
import type { ChartPoint } from './Chart.tsx';
import { strings } from './strings.ts';
import styles from './ChartPlot.module.css';

/** The drawing's height: the plot's slot is the same height, `size-menu`. */
export const PLOT_HEIGHT = 240;

const TOP = 20;
const BOTTOM = 32;
const RIGHT = 8;
/** The most a tooltip's middle is held from either edge, so its box stays inside the plot. */
const TIP_EDGE = 56;

/** Props for the drawing. */
export interface ChartPlotProps {
  readonly kind: 'bar' | 'line';
  readonly label: string;
  readonly points: readonly ChartPoint[];
  /** The slot's width in pixels, from the frame. */
  readonly width: number;
  /** An axis tick as short text ("$10K"). */
  readonly formatTick: (value: number) => string;
}

/**
 * The marks of a bar or line chart in one SVG: hairline grid, ticks, one series in the first data colour, the
 * largest bar labelled, and a tooltip under the pointer. It takes no focus; the table view is the keyboard path.
 */
export function ChartPlot({ kind, label, points, width, formatTick }: ChartPlotProps) {
  const [hover, setHover] = useState<number | undefined>(undefined);
  const values = points.map((point) => Math.max(0, point.value));
  const { ticks, top } = niceTicks(Math.max(0, ...values));
  const tickLabels = ticks.map((tick) => formatTick(tick));
  const left = Math.max(32, Math.max(...tickLabels.map((text) => text.length)) * 6.2 + 12);
  const plotWidth = Math.max(0, width - left - RIGHT);
  const plotHeight = PLOT_HEIGHT - TOP - BOTTOM;
  const y = (value: number) => TOP + plotHeight * (1 - Math.max(0, value) / top);
  const count = points.length;
  const slot = count > 0 ? plotWidth / count : plotWidth;
  const centre = (index: number) => left + slot * (index + 0.5);
  const widest = Math.max(0, ...points.map((point) => (point.axisLabel ?? point.label).length));
  const fits = charsThatFit(slot - 6);
  const step = labelStep(count, slot, Math.min(widest, fits));
  const biggest = values.indexOf(Math.max(...values));

  const move = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left - left;
    setHover(x < 0 || x > plotWidth || count === 0 ? undefined : nearestIndex(x, count, plotWidth));
  };

  const line = points.map((_, index) => ({ x: centre(index), y: y(values[index] ?? 0) }));
  // The line ends in a dot, and the point under the pointer gets one.
  const dots = [...new Set([count - 1, ...(hover === undefined ? [] : [hover])])];
  const hovered = hover === undefined ? undefined : points[hover];
  const hoveredTop = hover === undefined ? 0 : (line[hover]?.y ?? 0);
  const tipX =
    hover === undefined ? 0 : Math.min(Math.max(centre(hover), TIP_EDGE), Math.max(TIP_EDGE, width - TIP_EDGE));
  const summary = strings.summary(
    label,
    points.map((point) => strings.part(point.label, point.valueText)),
  );

  return (
    <div className={styles.plot}>
      <svg
        className={styles.svg}
        width={width}
        height={PLOT_HEIGHT}
        role="img"
        aria-label={summary}
        onPointerMove={move}
        onPointerDown={move}
        onPointerLeave={() => {
          setHover(undefined);
        }}
      >
        {ticks.map((tick, index) => (
          <g key={tick}>
            <line
              className={styles.grid}
              data-base={tick === 0 || undefined}
              x1={left}
              x2={width - RIGHT}
              y1={y(tick)}
              y2={y(tick)}
            />
            <text className={styles.tick} x={left - 8} y={y(tick)} dy="0.32em" textAnchor="end">
              {tickLabels[index]}
            </text>
          </g>
        ))}
        {kind === 'bar' ? (
          points.map((point, index) => {
            const { start, bar, x } = barSlot(index, count, plotWidth);
            const value = values[index] ?? 0;
            const height = plotHeight * (value / top);
            return (
              <g key={point.id}>
                <rect
                  className={styles.band}
                  data-hovered={hover === index || undefined}
                  x={left + start}
                  y={TOP}
                  width={slot}
                  height={plotHeight}
                />
                <path className={styles.bar} d={barPath(left + x, y(value), bar, height)} />
                {index === biggest && value > 0 && (
                  <text className={styles.value} x={centre(index)} y={y(value) - 6} textAnchor="middle">
                    {point.valueText}
                  </text>
                )}
              </g>
            );
          })
        ) : (
          <>
            {hover !== undefined && (
              <line className={styles.crosshair} x1={centre(hover)} x2={centre(hover)} y1={TOP} y2={TOP + plotHeight} />
            )}
            <path className={styles.area} d={areaPath(line, TOP + plotHeight)} />
            <path className={styles.line} d={linePath(line)} />
            {dots.map((index) => {
              const dot = line[index];
              return dot === undefined ? null : (
                <circle key={index} className={styles.dot} cx={dot.x} cy={dot.y} r={4} />
              );
            })}
          </>
        )}
        {points.map((point, index) =>
          index % step === 0 ? (
            <text key={point.id} className={styles.xlabel} x={centre(index)} y={PLOT_HEIGHT - 12} textAnchor="middle">
              {cutLabel(point.axisLabel ?? point.label, kind === 'bar' ? fits : Math.max(fits, 8))}
            </text>
          ) : null,
        )}
      </svg>
      {hovered !== undefined && (
        <div
          className={styles.tip}
          style={{ '--x': `${String(tipX)}px`, '--y': `${String(hoveredTop)}px` }}
          aria-hidden="true"
        >
          <span className={styles.tipValue}>{hovered.valueText}</span>
          <span className={styles.tipLabel}>{hovered.label}</span>
        </div>
      )}
    </div>
  );
}
