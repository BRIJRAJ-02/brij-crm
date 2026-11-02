// Brief
// Purpose: a form's Analytics tab (spec 0063, AC-6321): how many saw it, how many started, how many finished, how
// long it takes, which question loses people, and where they came from, over 7, 30 or 90 days against the period
// before.
// Main task: find the question that loses people, so it can be fixed where it is edited.
// Leaves out: anything about one visitor (every figure is a count of daily hashes, never a person), and live
// updates — a visitor sends no change event here, so the figures are read when the tab opens and when the person
// comes back to it.
import type {
  DataLayer,
  FormAnalytics,
  FormAnalyticsHeld,
  FormAnalyticsRange,
  FormAnalyticsState,
  FormView,
} from '@crm/data';
import { useFormAnalytics } from '@crm/data/react';
import {
  EmptyState,
  FieldGroup,
  SegmentedControl,
  Separator,
  Skeleton,
  Stats,
  Table,
  type StatItem,
} from '@crm/ui';
import { lazy, Suspense, useMemo, useState } from 'react';
import { strings } from './strings.ts';

/** The chart, loaded with the first tab that has figures to draw: never in the editor's own chunk (AC-6331). */
const Chart = lazy(() => import('@crm/ui/charts').then((charts) => ({ default: charts.Chart })));

/** The ranges the tab offers (AC-6321). */
const RANGES: readonly FormAnalyticsRange[] = [7, 30, 90];

/** A count as the browser's language writes it. */
const figure = (count: number) => new Intl.NumberFormat().format(count);

/** A share of a whole, as a whole percent: "50%". A whole of zero is "0%", never a division by nothing. */
const percent = (part: number, whole: number) =>
  whole === 0 ? '0%' : new Intl.NumberFormat(undefined, { style: 'percent' }).format(part / whole);

/** A duration in words, to the nearest sensible unit: "45s", "2m 30s", "1h 4m". */
function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rest = seconds % 60;
    return rest === 0 ? `${String(minutes)}m` : `${String(minutes)}m ${String(rest)}s`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(rest)}m`;
}

/** A number against the one before it, as a Stat's comparison and trend (no colour: up isn't always good). */
function compared(now: number, before: number, days: number, format: (value: number) => string): Partial<StatItem> {
  return {
    comparison: strings.analyticsBefore(format(before), days),
    trend: now === before ? 'same' : now > before ? 'up' : 'down',
  };
}

/** A source as a person reads it: `direct` as a word, a UTM source or a host as itself. */
function sourceWords(source: string): string {
  if (source === 'direct') return strings.analyticsDirect;
  if (source.startsWith('utm:')) return source.slice(4);
  if (source.startsWith('ref:')) return source.slice(4);
  return source;
}

/** Props for AnalyticsTab. */
export interface AnalyticsTabProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly form: FormView;
}

/** The four headline figures, each against the period before (AC-6321). */
function headlineOf(analytics: FormAnalytics): readonly StatItem[] {
  const { totals, previous, range } = analytics;
  const median = totals.medianMs;
  return [
    {
      id: 'views',
      label: strings.analyticsViews,
      value: figure(totals.views),
      ...compared(totals.views, previous.views, range, figure),
    },
    {
      id: 'starts',
      label: strings.analyticsStarts,
      value: figure(totals.starts),
      ...compared(totals.starts, previous.starts, range, figure),
    },
    {
      // The rate people compare forms on: finishes of starts, not of views, since a view may never be a fill.
      id: 'completion',
      label: strings.analyticsCompletion,
      value: percent(totals.completions, totals.starts),
      ...compared(
        totals.starts === 0 ? 0 : totals.completions / totals.starts,
        previous.starts === 0 ? 0 : previous.completions / previous.starts,
        range,
        (value) => percent(value, 1),
      ),
    },
    {
      id: 'median',
      label: strings.analyticsMedian,
      value: median === undefined ? '—' : duration(median),
      ...(previous.medianMs === undefined || median === undefined
        ? { comparison: median === undefined ? strings.analyticsNoMedian : undefined }
        : compared(median, previous.medianMs, range, duration)),
    },
  ];
}

/**
 * A form's Analytics tab. The range is the one piece of state here; everything
 * else is the server's answer, read through the data layer's held read, so
 * coming back to the tab reads it again and leaving it stops.
 */
export function AnalyticsTab({ data, slug, form }: AnalyticsTabProps) {
  const [range, setRange] = useState<FormAnalyticsRange>(30);
  const view = useMemo(() => data.forms.analytics(slug, form.id, range), [data, slug, form.id, range]);
  const state = useFormAnalytics(view);

  // The questions the live form asks, in order, so a drop off row can be named where it is edited.
  const labels = useMemo(() => {
    // The live version's questions: the tab exists only for a published form, and a visit counted against a
    // question the draft has renamed should still read as the question the visitor actually saw.
    const document = form.live ?? form.draft;
    return new Map(document.questions.map((question) => [question.id, question.label]));
  }, [form.live, form.draft]);

  const period = (
    <SegmentedControl
      label={strings.analyticsPeriod}
      size="compact"
      value={String(range)}
      onChange={(next) => {
        const found = RANGES.find((each) => String(each) === next);
        if (found !== undefined) setRange(found);
      }}
      segments={RANGES.map((each) => ({ value: String(each), label: strings.analyticsDays(each) }))}
    />
  );

  if (state.status === 'loading') {
    return (
      <FieldGroup tone="heading" headingLevel={2} label={strings.analytics}>
        {period}
        <Skeleton shape="fill" />
      </FieldGroup>
    );
  }
  if (state.status === 'error') {
    return (
      <FieldGroup tone="heading" headingLevel={2} label={strings.analytics}>
        {period}
        {/* EmptyState's own error tone draws Try again from `onRetry`: no second button style here. */}
        <EmptyState tone="error" title={strings.analyticsFailed} onRetry={() => view.reload()}>
          {state.message}
        </EmptyState>
      </FieldGroup>
    );
  }

  const { analytics } = state;
  // Empty is a sentence and the way to fix it (AC-6321), never a row of flat bars pretending to be data.
  if (analytics.totals.views === 0 && analytics.previous.views === 0) {
    return (
      <FieldGroup tone="heading" headingLevel={2} label={strings.analytics}>
        {period}
        <EmptyState icon="chart-line" title={strings.analyticsEmpty}>
          {strings.analyticsEmptyText}
        </EmptyState>
      </FieldGroup>
    );
  }

  const dayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const dayPoints = analytics.byDay.map((each) => {
    const label = dayFormat.format(new Date(`${each.day}T00:00:00Z`));
    return { id: each.day, label, axisLabel: label, value: each.views, valueText: figure(each.views) };
  });
  // Only the questions somebody reached: a bar per unreached question would be a row of zeroes saying nothing.
  const dropOff = analytics.byQuestion.filter((row) => row.reached > 0);
  const dropPoints = dropOff.map((row) => {
    const label = labels.get(row.questionId) ?? row.questionId;
    return { id: row.questionId, label, axisLabel: label, value: row.leftHere, valueText: figure(row.leftHere) };
  });

  return (
    <FieldGroup tone="heading" headingLevel={2} label={strings.analytics}>
      {period}
      <Stats label={strings.analytics} items={headlineOf(analytics)} />
      {dayPoints.length > 1 && (
        <Suspense fallback={<Skeleton shape="fill" />}>
          <Chart
            kind="line"
            label={strings.analyticsChart(analytics.range)}
            pointLabel={strings.analyticsDay}
            valueLabel={strings.analyticsViews}
            points={dayPoints}
            formatTick={(value) => figure(value)}
          />
        </Suspense>
      )}
      {dropPoints.length > 0 && (
        <>
          <Separator />
          <FieldGroup tone="heading" headingLevel={3} label={strings.analyticsDropOff}>
            <Suspense fallback={<Skeleton shape="fill" />}>
              <Chart
                kind="bar"
                label={strings.analyticsDropOffChart}
                pointLabel={strings.analyticsQuestion}
                valueLabel={strings.analyticsLeft}
                points={dropPoints}
                formatTick={(value) => figure(value)}
              />
            </Suspense>
          </FieldGroup>
        </>
      )}
      <Separator />
      <FieldGroup tone="heading" headingLevel={3} label={strings.analyticsSources}>
        <Table
          label={strings.analyticsSources}
          columns={[
            { id: 'source', label: strings.analyticsSource, isRowHeader: true },
            { id: 'views', label: strings.analyticsViews, align: 'end', size: 'fit' },
            { id: 'completions', label: strings.analyticsCompletions, align: 'end', size: 'fit' },
          ]}
          rows={analytics.bySource}
          getRowId={(row) => row.source}
          renderCell={(row, column) =>
            column === 'source'
              ? sourceWords(row.source)
              : column === 'views'
                ? figure(row.views)
                : figure(row.completions)
          }
        />
      </FieldGroup>
    </FieldGroup>
  );
}

/** The range the Form tab's chips read (AC-6322): the Analytics tab's own default, so the two share one read. */
export const FORM_CHIP_RANGE: FormAnalyticsRange = 30;

/**
 * A stand in for a form with no analytics to read: a draft. Its snapshot is
 * one frozen object, because `useSyncExternalStore` compares snapshots by
 * identity — a fresh object here would re-render for ever.
 */
const NO_ANALYTICS_STATE: FormAnalyticsState = { status: 'loading' };
const NO_ANALYTICS: FormAnalyticsHeld = {
  subscribe: () => () => undefined,
  getSnapshot: () => NO_ANALYTICS_STATE,
  retain: () => () => undefined,
  reload: () => undefined,
};

/**
 * Each question's chip for the Form tab (AC-6322): "82% answered", by question
 * id, so a weak question is visible where it is edited.
 *
 * A question nobody reached gets no entry at all, and a form nobody has
 * visited gets no map: a chip reading "0% answered" on a question no one has
 * seen would be a statement about the form's traffic dressed up as one about
 * the question.
 */
export function useQuestionStats(view: FormAnalyticsHeld | undefined): ReadonlyMap<string, string> | undefined {
  const state = useFormAnalytics(view ?? NO_ANALYTICS);
  return useMemo(() => {
    if (state.status !== 'ready') return undefined;
    const entries = state.analytics.byQuestion.flatMap((row) =>
      row.reached === 0 ? [] : ([[row.questionId, strings.analyticsChip(percent(row.answered, row.reached))]] as const),
    );
    return entries.length === 0 ? undefined : new Map(entries);
  }, [state]);
}
