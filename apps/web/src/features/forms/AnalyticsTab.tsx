// Brief
// Purpose: a form's Analytics tab (spec 0063, AC-6321): how many saw it, how many started, how many finished, how
// long it takes, which question loses people, and where they came from, over 7, 30 or 90 days against the period
// before.
// Main task: find the question that loses people, so it can be fixed where it is edited.
// Leaves out: anything about one visitor (every figure is a count of daily hashes, never a person), and live
// updates — a visitor sends no change event here, so the figures are read when the tab opens and when the person
// comes back to it.
import type { DataLayer, FormAnalytics, FormAnalyticsRange, FormView } from '@crm/data';
import { useFormAnalytics } from '@crm/data/react';
import { ButtonLink, EmptyState, SegmentedControl, SettingsStack, Skeleton, Stats, type StatItem } from '@crm/ui';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { PageInsights } from '../insights/PageInsights.tsx';
import { formHref } from './paths.ts';
import { useFormToolbarSlot } from './toolbarSlot.ts';
import { strings } from './strings.ts';

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

/** A question's name as the owner wrote it, or a plain stand in for one left blank. */
function nameOf(label: string | undefined): string {
  const name = label?.trim() ?? '';
  return name === '' ? strings.analyticsUnnamed : name;
}

/** Props for AnalyticsTab. */
export interface AnalyticsTabProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly form: FormView;
}

/**
 * The five figure cards (T45, one row): Views, Starts, Finished, Completion and Median time, each against the period
 * before only when there was something before ("+100% vs 30 days before" from nothing says nothing).
 */
function statsOf(analytics: FormAnalytics): readonly StatItem[] {
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
      id: 'finished',
      label: strings.analyticsCompletions,
      value: figure(totals.completions),
      ...(hadBefore ? compared(totals.completions, previous.completions, range, figure) : {}),
    },
    {
      id: 'completion',
      label: strings.analyticsCompletion,
      value: percent(totals.completions, totals.starts),
      comparison: strings.analyticsFinishedOf(figure(totals.completions), figure(totals.starts)),
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
        <EmptyState
          icon="chart-line"
          title={strings.analyticsEmpty}
          actions={<ButtonLink href={formHref(slug, form.id, 'share')}>{strings.analyticsShareIt}</ButtonLink>}
        >
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
        <Stats label={strings.analyticsSummary} items={statsOf(analytics)} variant="cards" />
        <EmptyState icon="chart-line" title={strings.analyticsNoneInRange}>
          {strings.analyticsNoneInRangeText}
        </EmptyState>
      </SettingsStack>
    );
  }

  const dayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const dayOnly = new Intl.DateTimeFormat(undefined, { day: 'numeric', timeZone: 'UTC' });
  // Where people stop, by the question's own words, of those who started (T45: never "Q3", never a chart of two).
  const steps = analytics.byQuestion
    .filter((row) => row.reached > 0)
    .map((row) => ({
      id: row.questionId,
      name: nameOf(labels.get(row.questionId)),
      reached: row.reached,
      stopped: row.leftHere,
    }));
  return (
    <SettingsStack>
      {period}
      <PageInsights
        stats={statsOf(analytics)}
        started={analytics.totals.starts}
        steps={steps}
        stepLabel={strings.analyticsQuestion}
        sources={analytics.bySource.map((row) => ({
          id: row.source,
          name: sourceWords(row.source),
          views: row.views,
          finished: row.completions,
        }))}
        days={analytics.byDay.map((each) => {
          const when = new Date(`${each.day}T00:00:00Z`);
          return { id: each.day, label: dayFormat.format(when), axisLabel: dayOnly.format(when), views: each.views };
        })}
        periodWords={strings.analyticsLastDays(analytics.range)}
      />
    </SettingsStack>
  );
}
