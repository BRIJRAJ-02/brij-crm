import { useRef, useState } from 'react';
import type { LoadStatus } from '../../lib/load-status.ts';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { SegmentedControl } from '../../molecules/SegmentedControl/SegmentedControl.tsx';
import { Stats } from '../../molecules/Stats/Stats.tsx';
import { Table } from '../../molecules/Table/Table.tsx';
import { ChartPlot } from './ChartPlot.tsx';
import { strings } from './strings.ts';
import { useChartWidth } from './useChartWidth.ts';
import styles from './Chart.module.css';

/** One bar, point or number of a chart, with its words already made: the chart formats nothing. */
export interface ChartPoint {
  readonly id: string;
  /** What it stands for ("Negotiation", "October 2026"): the tooltip and the table. */
  readonly label: string;
  /** A shorter label for the axis ("Oct"); `label` when left out. */
  readonly axisLabel?: string;
  /** The number to draw. Below zero draws as zero; the table keeps the true figure in `valueText`. */
  readonly value: number;
  /** The value as words ("$12,400", "38"). */
  readonly valueText: string;
}

/** A bar chart, a line over periods, or one big number. */
export type ChartKind = 'bar' | 'line' | 'number';

/** Props for Chart. */
export interface ChartProps {
  readonly kind: ChartKind;
  /** What it shows ("Pipeline by stage"): the drawing's name for screen readers, and the table's. */
  readonly label: string;
  /** What each point stands for, the table's first column ("Stage", "Month"). */
  readonly pointLabel: string;
  /** What each value is, the table's second column and a number's label ("Value", "Deals"). */
  readonly valueLabel: string;
  /** The points, in the order they are drawn. A `number` draws the first. */
  readonly points: readonly ChartPoint[];
  /** An axis tick as short text ("$10K"). */
  readonly formatTick: (value: number) => string;
  /** `ready` (the default), `loading`, `error` (with Try again when there is `onRetry`) or `no-access`. */
  readonly status?: LoadStatus;
  /** A newer read is out: the figures shown stay, a step dimmer. */
  readonly isRefreshing?: boolean;
  readonly onRetry?: () => void;
}

/**
 * A report's chart: a bar chart or a line in SVG that changes theme with no new render, a big number, or the same
 * figures as a table; with its loading, empty, error and no access states in the one slot, so the page never
 * jumps. Marks take no focus: the table is the keyboard path. Loaded by the Reports page's own chunk, never the
 * first load.
 */
export function Chart({
  kind,
  label,
  pointLabel,
  valueLabel,
  points,
  formatTick,
  status = 'ready',
  isRefreshing = false,
  onRetry,
}: ChartProps) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const frame = useRef<HTMLDivElement>(null);
  const width = useChartWidth(frame);
  const isDrawn = kind !== 'number';
  const isEmpty = isDrawn && points.every((point) => point.value === 0);
  const isReady = status === 'ready';

  return (
    <section className={styles.root} aria-label={label} aria-busy={status === 'loading' || undefined}>
      {isReady && isDrawn && !isEmpty && (
        <div className={styles.head}>
          <SegmentedControl
            label={strings.view}
            size="compact"
            value={view}
            onChange={(next) => {
              setView(next === 'table' ? 'table' : 'chart');
            }}
            segments={[
              {
                value: 'chart',
                label: strings.chart,
                icon: kind === 'line' ? 'chart-line' : 'chart-bar',
                isIconOnly: true,
              },
              { value: 'table', label: strings.table, icon: 'table', isIconOnly: true },
            ]}
          />
        </div>
      )}
      <div ref={frame} className={styles.frame} data-refreshing={isRefreshing || undefined} data-kind={kind}>
        {status === 'loading' ? (
          <EmptyState isLoading layout="fill" title={strings.loading} />
        ) : status === 'error' ? (
          <EmptyState
            tone="error"
            layout="fill"
            title={strings.errorTitle}
            {...(onRetry === undefined ? {} : { onRetry })}
          >
            {strings.errorText}
          </EmptyState>
        ) : status === 'no-access' ? (
          <EmptyState tone="locked" layout="fill" title={strings.noAccessTitle}>
            {strings.noAccessText}
          </EmptyState>
        ) : isEmpty ? (
          <EmptyState layout="fill" icon={kind === 'line' ? 'chart-line' : 'chart-bar'} title={strings.emptyTitle}>
            {strings.emptyText}
          </EmptyState>
        ) : !isDrawn ? (
          <Stats
            label={label}
            size="large"
            items={[{ id: 'total', label: valueLabel, value: points[0]?.valueText ?? '' }]}
          />
        ) : view === 'table' ? (
          <Table
            label={label}
            columns={[
              { id: 'point', label: pointLabel, isRowHeader: true },
              { id: 'value', label: valueLabel, align: 'end' },
            ]}
            rows={points}
            getRowId={(point) => point.id}
            renderCell={(point, column) => (column === 'point' ? point.label : point.valueText)}
          />
        ) : width > 0 ? (
          <ChartPlot kind={kind} label={label} points={points} width={width} formatTick={formatTick} />
        ) : null}
      </div>
    </section>
  );
}
