// Brief
// Purpose: one page's numbers (a form today; a booking page and the link page next), in the shape the Insights
//   screen uses: a row of figure cards, where people stop as a list with the worst stop said in one sentence, the
//   views over time once there are enough, and where they come from as a short table.
// Main task: see at a glance how many came, started and finished, and which step loses people.
// Leaves out: anything about one visitor, a chart of a handful of people (a list says it better), fractions of a
//   person on any axis, and the period control, which the screen places in its own toolbar.
import { Card, EmptyState, Meter, Skeleton, Stats, Table, useFormatSettings, type StatItem } from '@crm/ui';
import { lazy, Suspense, type ReactNode } from 'react';
import { figure, percent } from './format.ts';
import { pageStrings as strings } from './page-strings.ts';

/** The chart, loaded with the first page that has enough to draw: never in the first load. */
const Chart = lazy(() => import('@crm/ui/charts').then((charts) => ({ default: charts.Chart })));

/** Below this many starts the stops are a list of numbers: bars over two or three people say nothing a number can't. */
export const BARS_FROM_STARTS = 5;

/** One place people can stop (a form's question or step, a booking page's step), in the order a visitor meets them. */
export interface PageStep {
  readonly id: string;
  /** Its name as the owner wrote it: the question itself, never "Q3". */
  readonly name: string;
  /** People who got to it, of those who started. */
  readonly reached: number;
  /** People who got to it and went no further. */
  readonly stopped: number;
}

/** One source of visits. */
export interface PageSource {
  readonly id: string;
  readonly name: string;
  readonly views: number;
  readonly finished: number;
}

/** One day's views, for the line over time. */
export interface PageDay {
  readonly id: string;
  /** The day in full, for the table and the tooltip ("Nov 4"). */
  readonly label: string;
  /** The day as the axis takes it ("4"). */
  readonly axisLabel: string;
  readonly views: number;
}

/** Props for PageInsights. */
export interface PageInsightsProps {
  /** The figure cards, in order (Views, Starts, Finished, Completion, Median time). */
  readonly stats: readonly StatItem[];
  /** How many started: the whole each step's bar is a share of. */
  readonly started: number;
  /** The places people can stop, in order; those nobody reached are left out by the caller. */
  readonly steps: readonly PageStep[];
  /** What one step is called in the table's header ("Question", "Step"). */
  readonly stepLabel: string;
  readonly sources: readonly PageSource[];
  readonly days: readonly PageDay[];
  /** The period in words, for the chart's name ("the last 30 days"). */
  readonly periodWords: string;
  /** What reads after where people stop, before the views over time: a form's Answers. */
  readonly answers?: ReactNode;
}

/** The step that lost the most people (the first of a tie), or none when nobody stopped part way. */
export function worstStep(steps: readonly PageStep[]): PageStep | undefined {
  return steps.reduce<PageStep | undefined>(
    (worst, step) => (step.stopped > 0 && (worst === undefined || step.stopped > worst.stopped) ? step : worst),
    undefined,
  );
}

/** The figure cards, where people stop, the views over time and the sources. */
export function PageInsights({
  stats,
  started,
  steps,
  stepLabel,
  sources,
  days,
  periodWords,
  answers,
}: PageInsightsProps) {
  const { locale } = useFormatSettings();
  const worst = worstStep(steps);
  const hasBars = started >= BARS_FROM_STARTS;
  const totalViews = sources.reduce((sum, source) => sum + source.views, 0);
  const sourceTop = Math.max(1, ...sources.map((source) => source.views));
  return (
    <>
      <Stats label={strings.summary} items={stats} variant="cards" />
      {started > 0 && steps.length > 0 && (
        <Card
          title={strings.stops}
          // The one thing to fix, in a sentence; the list under it is the evidence.
          description={
            worst === undefined
              ? strings.nobodyStopped
              : strings.worstStop(worst.name, figure(worst.stopped, locale), figure(worst.reached, locale))
          }
        >
          <Table
            label={strings.stopsTable}
            isScrollable
            columns={[
              { id: 'name', label: stepLabel, isRowHeader: true, size: 'fill' },
              { id: 'reached', label: strings.reached, align: 'end', size: 'fit' },
              ...(hasBars ? [{ id: 'bar', label: strings.share }] : []),
              { id: 'lost', label: strings.lost, align: 'end' as const, size: 'fit' as const },
            ]}
            rows={steps}
            // Rows and columns share React Aria's keys: a question whose id is "name" would collide with a column.
            getRowId={(step) => `step:${step.id}`}
            renderCell={(step, column) => {
              switch (column) {
                case 'name':
                  return step.name;
                case 'reached':
                  return figure(step.reached, locale);
                case 'bar':
                  return (
                    <Meter
                      tone="share"
                      label={step.name}
                      value={step.reached}
                      maxValue={started}
                      valueText={strings.ofStarted(figure(step.reached, locale), figure(started, locale))}
                    />
                  );
                default:
                  // A step nobody left reads as a dash, not "0% lost", so the eye finds the ones that did.
                  return step.stopped === 0 ? '—' : percent(step.stopped, step.reached, locale);
              }
            }}
          />
        </Card>
      )}
      {answers}
      {/* A line over time only once there is a line to see: a few views make a row of zeroes and one spike. */}
      {totalViews >= BARS_FROM_STARTS && days.length > 1 && (
        <Card title={strings.overTime}>
          <Suspense fallback={<Skeleton shape="fill" />}>
            <Chart
              kind="line"
              label={strings.overTimeChart(periodWords)}
              pointLabel={strings.day}
              valueLabel={strings.views}
              points={days.map((day) => ({
                id: day.id,
                label: day.label,
                axisLabel: day.axisLabel,
                value: day.views,
                valueText: figure(day.views, locale),
              }))}
              formatTick={(value) => figure(value, locale)}
            />
          </Suspense>
        </Card>
      )}
      <Card title={strings.sources}>
        <Table
          label={strings.sources}
          isScrollable
          columns={[
            { id: 'source', label: strings.source, isRowHeader: true, size: 'fill' },
            { id: 'views', label: strings.views, align: 'end', size: 'fit' },
            // Bars once there are enough views to compare, as the stops have them from enough starts.
            ...(totalViews >= BARS_FROM_STARTS ? [{ id: 'bar', label: strings.shareOfViews }] : []),
            { id: 'finished', label: strings.finished, align: 'end' as const, size: 'fit' as const },
          ]}
          rows={sources}
          getRowId={(source) => `source:${source.id}`}
          emptyState={<EmptyState layout="row" title={strings.noSources} />}
          renderCell={(source, column): ReactNode => {
            switch (column) {
              case 'source':
                return source.name;
              case 'views':
                return figure(source.views, locale);
              case 'bar':
                return (
                  <Meter
                    tone="share"
                    label={source.name}
                    value={source.views}
                    maxValue={sourceTop}
                    valueText={strings.ofViews(figure(source.views, locale), figure(totalViews, locale))}
                  />
                );
              default:
                return figure(source.finished, locale);
            }
          }}
        />
      </Card>
    </>
  );
}
