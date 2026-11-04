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
  DescriptionList,
  EmptyState,
  FieldGroup,
  SegmentedControl,
  SettingsStack,
  Skeleton,
  Stats,
  type StatItem,
} from '@crm/ui';
import { lazy, Suspense, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFormToolbarSlot } from './toolbarSlot.ts';
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

/**
 * A figure against the one before it, as a Stat's comparison and trend (no
 * colour: up isn't always good). It shows the *change*, signed, rather than
 * the previous absolute figure: "540" over "540 in the 30 days before" reads
 * as a restatement, and when the two differ a reader should not have to
 * subtract in their head.
 */
function compared(now: number, before: number, days: number, format: (value: number) => string): Partial<StatItem> {
  if (now === before) return { comparison: strings.analyticsNoChange(days), trend: 'same' };
  const up = now > before;
  const change = `${up ? '+' : '−'}${format(Math.abs(now - before))}`;
  return { comparison: strings.analyticsChange(change, days), trend: up ? 'up' : 'down' };
}

/**
 * The median's own comparison. It is the one figure here where less is
 * better, so an arrow would mean the opposite of what it looks like next to
 * Views: a form that got slower would show the same ↑ as a form that got more
 * visitors. The change is said in words instead, and no arrow is drawn.
 */
function comparedTime(now: number | undefined, before: number | undefined): Partial<StatItem> {
  if (now === undefined) return { comparison: strings.analyticsNoMedian };
  if (before === undefined || now === before) return {};
  const by = duration(Math.abs(now - before));
  return { comparison: now < before ? strings.analyticsFaster(by) : strings.analyticsSlower(by) };
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

/**
 * The hero figure (T22, 5 November 2026: one figure leads): completion, the rate people compare forms on, finishes
 * of starts (a view may never be a fill), said with the counts behind it rather than against a period with nothing.
 */
function heroOf(analytics: FormAnalytics): readonly StatItem[] {
  const { totals } = analytics;
  return [
    {
      id: 'completion',
      label: strings.analyticsCompletion,
      value: percent(totals.completions, totals.starts),
      comparison: strings.analyticsFinishedOf(figure(totals.completions), figure(totals.starts)),
    },
  ];
}

/**
 * The figures under the hero, each against the period before only when there was something before (T22: "+100% vs
 * 30 days before" from nothing says nothing).
 */
function headlineOf(analytics: FormAnalytics): readonly StatItem[] {
  const { totals, previous, range } = analytics;
  const median = totals.medianMs;
  const hadBefore = previous.views > 0;
  return [
    {
      id: 'views',
      label: strings.analyticsViews,
      value: figure(totals.views),
      ...(hadBefore ? compared(totals.views, previous.views, range, figure) : {}),
    },
    {
      id: 'starts',
      label: strings.analyticsStarts,
      value: figure(totals.starts),
      ...(hadBefore ? compared(totals.starts, previous.starts, range, figure) : {}),
    },
    {
      id: 'median',
      label: strings.analyticsMedian,
      value: median === undefined ? '—' : duration(median),
      ...(hadBefore || median === undefined ? comparedTime(median, previous.medianMs) : {}),
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

  // The period sits at the end of the tab strip, as Submissions' tools do (T22: it was jammed onto the figures), so
  // the page opens on the figures themselves. Before the editor has drawn the strip it sits at the top instead.
  const slot = useFormToolbarSlot();
  const switcher = (
    <SegmentedControl
      label={strings.analyticsPeriod}
      size="compact"
      isFitted
      value={String(range)}
      onChange={(next) => {
        const found = RANGES.find((each) => String(each) === next);
        if (found !== undefined) setRange(found);
      }}
      segments={RANGES.map((each) => ({ value: String(each), label: strings.analyticsDays(each) }))}
    />
  );
  const period = slot === null ? switcher : createPortal(switcher, slot);

  if (state.status === 'loading') {
    return (
      <SettingsStack>
        {period}
        <Skeleton shape="fill" />
      </SettingsStack>
    );
  }
  if (state.status === 'error') {
    return (
      <SettingsStack>
        {period}
        {/* EmptyState's own error tone draws Try again from `onRetry`: no second button style here. */}
        <EmptyState tone="error" title={strings.analyticsFailed} onRetry={() => view.reload()}>
          {state.message}
        </EmptyState>
      </SettingsStack>
    );
  }

  const { analytics } = state;
  // Empty is a sentence and the way to fix it (AC-6321), never a row of flat bars pretending to be data.
  if (analytics.totals.views === 0 && analytics.previous.views === 0) {
    return (
      <SettingsStack>
        {period}
        <EmptyState icon="chart-line" title={strings.analyticsEmpty}>
          {strings.analyticsEmptyText}
        </EmptyState>
      </SettingsStack>
    );
  }

  // Nothing in this range, but the form has been seen before now: the range control stays, so the way out is
  // obvious, and nothing is drawn as a flat line pretending to be data.
  if (analytics.totals.views === 0) {
    return (
      <SettingsStack>
        {period}
        <Stats label={strings.analyticsSummary} items={headlineOf(analytics)} />
        <EmptyState icon="chart-line" title={strings.analyticsNoneInRange}>
          {strings.analyticsNoneInRangeText}
        </EmptyState>
      </SettingsStack>
    );
  }

  const dayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const dayOnly = new Intl.DateTimeFormat(undefined, { day: 'numeric', timeZone: 'UTC' });
  const dayPoints = analytics.byDay.map((each) => {
    const when = new Date(`${each.day}T00:00:00Z`);
    // The axis takes the day number alone, so 30 and 90 day ranges don't run their labels together; the tooltip
    // and the table view read `label`, which keeps the month.
    return {
      id: each.day,
      label: dayFormat.format(when),
      axisLabel: dayOnly.format(when),
      value: each.views,
      valueText: figure(each.views),
    };
  });
  // Only the questions somebody reached: a bar per unreached question would be a row of zeroes saying nothing.
  const dropOff = analytics.byQuestion.filter((row) => row.reached > 0);
  // The axis takes the question's place in the form, so five bars never lose a label to a long question; the
  // tooltip and the table view read `label`, which is the question itself.
  const order = new Map(analytics.byQuestion.map((row, at) => [row.questionId, at + 1]));
  const dropPoints = dropOff.map((row) => ({
    id: row.questionId,
    label: labels.get(row.questionId) ?? row.questionId,
    axisLabel: strings.analyticsQuestionAt(order.get(row.questionId) ?? 0),
    value: row.leftHere,
    valueText: figure(row.leftHere),
  }));

  // Somebody started and nobody stopped: said in words, never as an empty chart (T22).
  const nobodyLeft = dropPoints.every((point) => point.value === 0);
  return (
    <SettingsStack>
      {period}
      <Stats label={strings.analyticsCompletion} items={heroOf(analytics)} size="large" />
      <Stats label={strings.analyticsSummary} items={headlineOf(analytics)} />
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
      {analytics.totals.starts > 0 && (
        <FieldGroup tone="heading" headingLevel={2} label={strings.analyticsDropOff}>
          {nobodyLeft ? (
            <EmptyState layout="row" icon="circle-check" title={strings.analyticsAllFinished} />
          ) : (
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
          )}
        </FieldGroup>
      )}
      <FieldGroup tone="heading" headingLevel={2} label={strings.analyticsSources}>
        {analytics.bySource.length === 0 ? (
          <EmptyState layout="row" title={strings.analyticsNoSources} />
        ) : (
          // A short list, not a full width table: a source and its two counts read together (T22).
          <DescriptionList
            layout="compact"
            items={analytics.bySource.map((row) => ({
              id: row.source,
              term: sourceWords(row.source),
              description: strings.analyticsSourceLine(figure(row.views), figure(row.completions), row.views),
            }))}
          />
        )}
      </FieldGroup>
    </SettingsStack>
  );
}

/** One question's chip: the figure the card shows, and what it is of, as its tooltip. */
export interface QuestionStat {
  readonly stat: string;
  readonly statTitle: string;
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
export function useQuestionStats(view: FormAnalyticsHeld | undefined): ReadonlyMap<string, QuestionStat> | undefined {
  const state = useFormAnalytics(view ?? NO_ANALYTICS);
  return useMemo(() => {
    if (state.status !== 'ready') return undefined;
    const entries = state.analytics.byQuestion.flatMap((row) => {
      if (row.reached === 0) return [];
      const answered = percent(row.answered, row.reached);
      // The card has room for the percentage only, so the tooltip carries what it is a percentage of.
      const stat = {
        stat: strings.analyticsChip(answered),
        statTitle: strings.analyticsReached(answered, figure(row.reached)),
      };
      return [[row.questionId, stat]] as const;
    });
    return entries.length === 0 ? undefined : new Map(entries);
  }, [state]);
}
