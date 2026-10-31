// Brief
// Purpose: the link page's Insights (spec 0061, AC-6118 to AC-6120): how many came, from where, what they pressed,
// and how many went on to book, over 7, 30 or 90 days against the period before.
// Main task: see which place sends visitors and bookings, at a glance, and take the figures away as a CSV.
// Leaves out: anything about one visitor (the figures are days, facts and counts only, never a person), and live
// updates (a period's figures are read when the card shows, and kept a minute).
import type { LinkPageStore, ProfileCounts, ProfileItem } from '@crm/data';
import { useLinkPageInsights } from '@crm/data/react';
import {
  ButtonLink,
  Card,
  EmptyState,
  FieldGroup,
  SegmentedControl,
  Separator,
  Skeleton,
  Stats,
  Table,
  memoIntl,
  useFormatSettings,
  type StatItem,
} from '@crm/ui';
import { lazy, Suspense, useRef, useState } from 'react';
import { reachStrings as words } from './reach-strings.ts';
import { rowWords } from './registry.tsx';

/** The chart, loaded with the first Insights that has figures to draw: never in the editor's own chunk. */
const Chart = lazy(() => import('@crm/ui/charts').then((charts) => ({ default: charts.Chart })));

/** The four facts a view carries (AC-6116), in the order the card offers them. */
const FACTS = ['referrer', 'source', 'country', 'device'] as const;
type Fact = (typeof FACTS)[number];

/** How many values of a fact the card shows: the top 5 and Other (AC-6118). */
const TOP = 5;

/** Props for Insights. */
export interface InsightsProps {
  readonly linkPage: LinkPageStore;
  readonly slug: string;
  /** The live and archived blocks, to name each block's clicks. */
  readonly items: readonly ProfileItem[];
}

/** A number against the one before it, as a Stat's comparison and trend. */
function compared(now: number, before: number, days: number): Pick<StatItem, 'comparison' | 'trend'> {
  return {
    comparison: words.before(before, days),
    trend: now === before ? 'same' : now > before ? 'up' : 'down',
  };
}

/** The Insights card: the period, the headline figures, the chart, where they came from, clicks and the funnel. */
export function Insights({ linkPage, slug, items }: InsightsProps) {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const state = useLinkPageInsights(linkPage.reach.insights(slug, days));
  // The CSV's range is the period on screen, in the UTC days the counter files views under.
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const period = (
    <SegmentedControl
      label={words.period}
      size="compact"
      value={String(days)}
      onChange={(next) => {
        const found = linkPage.reach.insightDays.find((each) => String(each) === next);
        if (found !== undefined) setDays(found);
      }}
      segments={linkPage.reach.insightDays.map((each) => ({ value: String(each), label: words.days(each) }))}
    />
  );
  // A period switch keeps the last figures on screen until the new ones land, so the card never collapses to a
  // skeleton and grows back under the reader; the first read draws the figures' own shapes.
  const lastReady = useRef<ProfileCounts | undefined>(undefined);
  if (state.status === 'ready') lastReady.current = state.counts;
  const counts = state.status === 'ready' ? state.counts : undefined;
  const shown = counts ?? (state.status === 'loading' ? lastReady.current : undefined);
  const hasViews = counts !== undefined && counts.views > 0;
  return (
    <Card
      title={words.insights}
      description={words.insightsText}
      actions={
        <>
          {period}
          {/* Always in its place, so the period beside it never moves; off while the period has nothing to give. */}
          <ButtonLink
            variant="ghost"
            icon="download"
            href={linkPage.reach.insightsCsvHref(slug, from, today)}
            download=""
            isDisabled={!hasViews}
          >
            {words.csv}
          </ButtonLink>
        </>
      }
    >
      {shown !== undefined && state.status === 'loading' ? (
        <Figures counts={shown} items={items} />
      ) : state.status === 'loading' ? (
        <>
          <Stats label={words.insights} items={[]} isLoading />
          <Skeleton shape="fill" />
        </>
      ) : state.status === 'error' ? (
        <EmptyState
          tone="error"
          layout="row"
          title={words.failed}
          onRetry={() => linkPage.reach.insights(slug, days).retry()}
        />
      ) : state.counts.views === 0 && state.counts.before.views === 0 ? (
        <EmptyState layout="row" icon="chart-line" title={words.empty}>
          {words.emptyText}
        </EmptyState>
      ) : (
        <Figures counts={state.counts} items={items} />
      )}
    </Card>
  );
}

/** The figures once there are any. */
function Figures({ counts, items }: { readonly counts: ProfileCounts; readonly items: readonly ProfileItem[] }) {
  const { locale } = useFormatSettings();
  const [fact, setFact] = useState<Fact>('referrer');
  const dayFormat = memoIntl(
    `link-insight-day:${locale}`,
    // The days are UTC days, as the counter files them.
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
  );
  const presses = counts.funnel?.presses ?? counts.presses.reduce((sum, each) => sum + each.presses, 0);
  const bookings = counts.funnel?.bookings ?? 0;
  const headline: readonly StatItem[] = [
    {
      id: 'views',
      label: words.views,
      value: words.figure(counts.views),
      ...compared(counts.views, counts.before.views, counts.days),
    },
    {
      id: 'visitors',
      label: words.visitors,
      value: words.figure(counts.visitors),
      ...compared(counts.visitors, counts.before.visitors, counts.days),
    },
    // The funnel (AC-6119) as the two rates under their figures: clicks of views, bookings of clicks.
    {
      id: 'presses',
      label: words.presses,
      value: words.figure(presses),
      comparison: words.funnelPresses(words.rate(presses, counts.views)),
    },
    {
      id: 'bookings',
      label: words.bookings,
      value: words.figure(bookings),
      comparison: words.funnelBookings(words.rate(bookings, presses)),
    },
  ];
  const series = counts.series ?? [];
  const points = series.map((each) => {
    const label = dayFormat.format(new Date(`${each.day}T00:00:00Z`));
    return { id: each.day, label, axisLabel: label, value: each.views, valueText: words.figure(each.views) };
  });
  const values = (counts.facts?.[fact] ?? []).slice(0, TOP + 1);
  const named = new Map(items.map((item) => [item.id, rowWords(item).title]));
  const pressed = [...counts.presses].sort((one, other) => other.presses - one.presses);
  return (
    <>
      <Stats label={words.insights} items={headline} />
      {points.length > 1 && (
        <Suspense fallback={<Skeleton shape="fill" />}>
          <Chart
            kind="line"
            label={words.viewsChart(counts.days)}
            pointLabel={words.day}
            valueLabel={words.views}
            points={points}
            formatTick={(value) => words.figure(value)}
          />
        </Suspense>
      )}
      <Separator />
      <FieldGroup tone="heading" headingLevel={3} label={words.facts}>
        <SegmentedControl
          label={words.facts}
          size="compact"
          value={fact}
          onChange={(next) => {
            const found = FACTS.find((each) => each === next);
            if (found !== undefined) setFact(found);
          }}
          segments={FACTS.map((each) => ({ value: each, label: words[each] }))}
        />
        <Table
          label={words[fact]}
          columns={[
            { id: 'value', label: words[fact], isRowHeader: true },
            { id: 'views', label: words.views, align: 'end', size: 'fit' },
            { id: 'visitors', label: words.visitors, align: 'end', size: 'fit' },
          ]}
          rows={values}
          getRowId={(row) => row.value}
          renderCell={(row, column) =>
            column === 'value'
              ? factValue(fact, row.value, locale)
              : words.figure(column === 'views' ? row.views : row.visitors)
          }
          emptyState={<EmptyState layout="row" title={words.factNone} />}
        />
      </FieldGroup>
      <Separator />
      <FieldGroup tone="heading" headingLevel={3} label={words.blockPresses}>
        <Table
          label={words.blockPresses}
          columns={[
            { id: 'block', label: words.blockPresses, isRowHeader: true },
            { id: 'presses', label: words.presses, align: 'end', size: 'fit' },
          ]}
          rows={pressed}
          getRowId={(row) => row.id}
          // A block deleted within the period keeps its clicks, under a name that says so.
          renderCell={(row, column) =>
            column === 'block' ? (named.get(row.id) ?? words.deletedBlock) : words.figure(row.presses)
          }
          emptyState={<EmptyState layout="row" title={words.blockPressesNone} />}
        />
      </FieldGroup>
    </>
  );
}

/** A fact's value in words: a country's name, a device's, Direct and Other as they read; a site as its host. */
function factValue(fact: Fact, value: string, locale: string): string {
  if (value === 'Other') return words.other;
  if (value === 'Direct') return words.direct;
  if (fact === 'device') {
    if (value === 'mobile') return words.mobile;
    if (value === 'tablet') return words.tablet;
    if (value === 'desktop') return words.desktop;
  }
  if (fact === 'country' && /^[A-Z]{2}$/.test(value)) {
    try {
      return new Intl.DisplayNames([locale], { type: 'region' }).of(value) ?? value;
    } catch {
      return value;
    }
  }
  return value;
}
