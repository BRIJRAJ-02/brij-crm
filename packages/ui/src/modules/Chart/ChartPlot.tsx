import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type RefObject } from 'react';
import '../../lib/custom-properties.ts';
import {
  areaPath,
  barPath,
  barSlot,
  charsThatFit,
  cutLabel,
  estimateLabelWidth,
  labelStepFor,
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
/** The surface gap between a pair's two bars (the mark spec's 2px spacer). */
const PAIR_GAP = 2;
/** The most a tooltip's middle is held from either edge, so its box stays inside the plot. */
const TIP_EDGE = 56;
/** The x labels' type size before it is read from the page (text-label). */
const LABEL_SIZE = 12;

/** Measures a label in the x labels' own font, or estimates it where nothing can measure. */
type MeasureText = (text: string) => number;

/**
 * The x labels' font, read from a hidden label once the drawing is on the page, and a canvas that measures text in
 * it. Before then, and where there is no canvas, a conservative estimate stands in.
 */
function useLabelMeasure(): { readonly probe: RefObject<SVGTextElement | null>; readonly measure: MeasureText } {
  const probe = useRef<SVGTextElement>(null);
  const [font, setFont] = useState<{ readonly css: string; readonly size: number } | undefined>(undefined);
  useLayoutEffect(() => {
    const element = probe.current;
    if (element === null) return;
    const style = getComputedStyle(element);
    const size = Number.parseFloat(style.fontSize);
    setFont({
      css: `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
      size: Number.isFinite(size) ? size : LABEL_SIZE,
    });
  }, []);
  const measure = useMemo<MeasureText>(() => {
    const size = font?.size ?? LABEL_SIZE;
    const context = font === undefined ? null : document.createElement('canvas').getContext('2d');
    if (context === null || font === undefined) return (text) => estimateLabelWidth(text, size);
    context.font = font.css;
    // Tabular figures run a touch wider than the canvas's proportional ones: a pixel a character covers them.
    return (text) => context.measureText(text).width + text.length;
  }, [font]);
  return { probe, measure };
}

/** Props for the drawing. */
export interface ChartPlotProps {
  readonly kind: 'bar' | 'line';
  readonly label: string;
  readonly points: readonly ChartPoint[];
  /** The slot's width in pixels, from the frame. */
  readonly width: number;
  /** An axis tick as short text ("$10K"). */
  readonly formatTick: (value: number) => string;
  /** Bars only: each point's `compare` drawn beside its value under this name, with `valueLabel` naming the first. */
  readonly compareLabel?: string;
  readonly valueLabel?: string;
}

/**
 * The marks of a bar or line chart in one SVG: hairline grid, ticks, one series in the first data colour, the
 * largest bar labelled, and a tooltip under the pointer. It takes no focus; the table view is the keyboard path.
 */
export function ChartPlot({ kind, label, points, width, formatTick, compareLabel, valueLabel }: ChartPlotProps) {
  const [hover, setHover] = useState<number | undefined>(undefined);
  const isPaired = kind === 'bar' && compareLabel !== undefined;
  const values = points.map((point) => Math.max(0, point.value));
  const compares = points.map((point) => Math.max(0, point.compare ?? 0));
  // Counts draw whole ticks only: a chart of whole numbers never shows a 0.5 between them.
  const plotted = [...values, ...(isPaired ? compares : [])];
  const { ticks, top } = niceTicks(
    Math.max(0, ...plotted),
    4,
    plotted.every((value) => Number.isInteger(value)),
  );
  const tickLabels = ticks.map((tick) => formatTick(tick));
  const left = Math.max(32, Math.max(...tickLabels.map((text) => text.length)) * 6.2 + 12);
  const plotWidth = Math.max(0, width - left - RIGHT);
  const plotHeight = PLOT_HEIGHT - TOP - BOTTOM;
  const y = (value: number) => TOP + plotHeight * (1 - Math.max(0, value) / top);
  const count = points.length;
  const slot = count > 0 ? plotWidth / count : plotWidth;
  const centre = (index: number) => left + slot * (index + 0.5);
  const fits = charsThatFit(slot - 6);
  // Labels keep a floor of characters (a bar's 6, a line's 8), so a narrow plot thins its labels rather than cutting
  // each to a letter.
  const floor = kind === 'bar' ? Math.max(fits, 6) : Math.max(fits, 8);
  const { probe, measure } = useLabelMeasure();
  const axisLabels = points.map((point) => cutLabel(point.axisLabel ?? point.label, floor));
  // Thinned to the room there is, from each label's measured width, so no two drawn labels ever touch (T7).
  const step = labelStepFor(
    axisLabels.map((text) => measure(text)),
    slot,
  );
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
    points.map((point) =>
      isPaired
        ? strings.part(
            point.label,
            `${valueLabel ?? ''} ${point.valueText}, ${compareLabel} ${point.compareText ?? ''}`.trim(),
          )
        : strings.part(point.label, point.valueText),
    ),
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
            // A pair shares the slot: two thinner bars with the surface gap between them, the first on the left.
            const half = Math.max(2, (bar - PAIR_GAP) / 2);
            const second = compares[index] ?? 0;
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
                {isPaired ? (
                  <>
                    <path className={styles.bar} d={barPath(left + x, y(value), half, height)} />
                    <path
                      className={styles.bar}
                      data-series="compare"
                      d={barPath(left + x + half + PAIR_GAP, y(second), half, plotHeight * (second / top))}
                    />
                  </>
                ) : (
                  <path className={styles.bar} d={barPath(left + x, y(value), bar, height)} />
                )}
                {!isPaired && index === biggest && value > 0 && (
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
        {/* Read for the x labels' font, never seen. */}
        <text ref={probe} className={styles.xlabel} visibility="hidden" aria-hidden="true" x={0} y={0}>
          0
        </text>
        {points.map((point, index) =>
          index % step === 0 ? (
            <text key={point.id} className={styles.xlabel} x={centre(index)} y={PLOT_HEIGHT - 12} textAnchor="middle">
              {axisLabels[index]}
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
          {isPaired ? (
            <>
              <span className={styles.tipValue}>{`${valueLabel ?? ''} ${hovered.valueText}`.trim()}</span>
              <span className={styles.tipValue}>{`${compareLabel} ${hovered.compareText ?? ''}`.trim()}</span>
            </>
          ) : (
            <span className={styles.tipValue}>{hovered.valueText}</span>
          )}
          <span className={styles.tipLabel}>{hovered.label}</span>
        </div>
      )}
    </div>
  );
}
