// Brief
// Purpose: the numbers half of Insights (spec 0067, AC-6711 to AC-6714), shared by the signed in screen and a share
//   link's page: the four tiles against the period before, visits and finishes over time with the finish rate in a
//   chart of its own, where people stop with the biggest drop named, and the sources.
// Main task: see at a glance whether more people came and finished, and where the rest stopped.
// Leaves out: anything about one person (that is the Sessions table's, and never on a shared page), and a second
//   y axis: the rate is its own chart, on its own scale, never drawn over the counts.
import type { InsightNumbers } from '@crm/data';
import {
  Button,
  Card,
  EmptyState,
  FieldGroup,
  SegmentedControl,
  Skeleton,
  Stats,
  Table,
  TileGrid,
  useFormatSettings,
} from '@crm/ui';
import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { biggestDrop, figure, percent, sourceWord, stepWord, tilesOf } from './format.ts';
import { strings } from './strings.ts';

/** The chart, loaded with the first screen that draws one: never in the first load. */
const Chart = lazy(() => import('@crm/ui/charts').then((charts) => ({ default: charts.Chart })));

/** How the sources table is ordered. */
type SortKey = 'visits' | 'finishes' | 'rate';

/** Props for InsightsBody. */
export interface InsightsBodyProps {
  readonly numbers: InsightNumbers;
  /** A newer read is out: the figures stay, a step dimmer. */
  readonly isRefreshing?: boolean;
  /** Extra panels under the sources (the signed in screen's Other sites). */
  readonly sourcesAside?: ReactNode;
  /** One next action for a funnel over mixed kinds (the signed in screen offers Show forms). */
  readonly onPickKind?: () => void;
}

/** The tiles, the charts, the funnel and the sources. */
export function InsightsBody({ numbers, isRefreshing = false, sourcesAside, onPickKind }: InsightsBodyProps) {
  const { locale } = useFormatSettings();
  const [sort, setSort] = useState<SortKey>('visits');
  const tiles = useMemo(() => tilesOf(numbers, locale), [numbers, locale]);
  const dayFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    [locale],
  );
  const points = numbers.buckets.map((bucket) => {
    const when = dayFormat.format(new Date(`${bucket.start}T00:00:00Z`));
    return {
      id: bucket.start,
      label: numbers.grain === 'week' ? strings.weekOf(when) : when,
      axisLabel: when,
      value: bucket.visits,
      valueText: figure(bucket.visits, locale),
      compare: bucket.finishes,
      compareText: figure(bucket.finishes, locale),
    };
  });
  const ratePoints = numbers.buckets.map((bucket) => {
    const when = dayFormat.format(new Date(`${bucket.start}T00:00:00Z`));
    const rate = bucket.visits === 0 ? 0 : Math.round((bucket.finishes / bucket.visits) * 100);
    return {
      id: bucket.start,
      label: numbers.grain === 'week' ? strings.weekOf(when) : when,
      axisLabel: when,
      value: rate,
      valueText: percent(bucket.finishes, bucket.visits, locale),
    };
  });
  const { funnel } = numbers;
  const drop = funnel === undefined ? undefined : biggestDrop(funnel, locale);
  const funnelPoints =
    funnel === undefined
      ? []
      : [
          ...funnel.steps.map((step) => ({
            id: step.step,
            label: stepWord(step.step),
            value: step.reached,
            valueText: `${figure(step.reached, locale)} (${percent(step.reached, funnel.steps[0]?.reached ?? 0, locale)})`,
          })),
          {
            id: 'finish',
            label: stepWord('finish', funnel.kind),
            value: funnel.finished,
            valueText: `${figure(funnel.finished, locale)} (${percent(funnel.finished, funnel.steps[0]?.reached ?? 0, locale)})`,
          },
        ];
  const sources = [...numbers.sources].sort((a, b) => {
    if (sort === 'finishes') return b.finishes - a.finishes || b.visits - a.visits;
    if (sort === 'rate') {
      const rate = (row: typeof a) => (row.visits === 0 ? 0 : row.finishes / row.visits);
      return rate(b) - rate(a) || b.visits - a.visits;
    }
    return b.visits - a.visits || b.finishes - a.finishes;
  });
  const grainWord = numbers.grain === 'week' ? strings.week : strings.day;

  return (
    <>
      <Stats label={strings.summary} items={tiles} />
      <Card title={strings.overTime}>
        <Suspense fallback={<Skeleton shape="fill" />}>
          <Chart
            kind="bar"
            label={strings.overTimeChart(numbers.grain)}
            pointLabel={grainWord}
            valueLabel={strings.visits}
            compareLabel={strings.finishes}
            points={points}
            formatTick={(value) => figure(value, locale)}
            isRefreshing={isRefreshing}
          />
          <FieldGroup label={strings.finishRate} tone="heading" headingLevel={4}>
            <Chart
              kind="line"
              label={strings.rateChart(numbers.grain)}
              pointLabel={grainWord}
              valueLabel={strings.finishRate}
              points={ratePoints}
              formatTick={(value) => `${String(value)}%`}
              isRefreshing={isRefreshing}
            />
          </FieldGroup>
        </Suspense>
      </Card>
      <TileGrid columns="two">
        <Card title={strings.funnel}>
          {funnel === undefined ? (
            <EmptyState
              icon="list-filter"
              layout="fill"
              title={strings.funnelPick}
              {...(onPickKind === undefined ? {} : { actions: <PickKind onPress={onPickKind} /> })}
            />
          ) : (
            <FieldGroup label={drop ?? strings.nobodyLeaves} tone="heading" headingLevel={4}>
              <Suspense fallback={<Skeleton shape="fill" />}>
                <Chart
                  kind="bar"
                  label={strings.funnelChart}
                  pointLabel={strings.step}
                  valueLabel={strings.reached}
                  points={funnelPoints}
                  formatTick={(value) => figure(value, locale)}
                  isRefreshing={isRefreshing}
                />
              </Suspense>
            </FieldGroup>
          )}
        </Card>
        <Card
          title={strings.sources}
          actions={
            <SegmentedControl
              label={strings.sortBy}
              size="compact"
              value={sort}
              onChange={(next) => {
                if (next === 'visits' || next === 'finishes' || next === 'rate') setSort(next);
              }}
              segments={[
                { value: 'visits', label: strings.visits },
                { value: 'finishes', label: strings.finishes },
                { value: 'rate', label: strings.rate },
              ]}
            />
          }
        >
          <Table
            label={strings.sources}
            isScrollable
            columns={[
              { id: 'source', label: strings.source, isRowHeader: true },
              { id: 'medium', label: strings.medium },
              { id: 'campaign', label: strings.campaign },
              { id: 'visits', label: strings.visits, align: 'end', size: 'fit' },
              { id: 'finishes', label: strings.finishes, align: 'end', size: 'fit' },
              { id: 'rate', label: strings.rate, align: 'end', size: 'fit' },
            ]}
            rows={sources}
            getRowId={(row) => `${row.source}|${row.medium}|${row.campaign}`}
            emptyState={<EmptyState layout="row" title={strings.noSources} />}
            renderCell={(row, column) => {
              switch (column) {
                case 'source':
                  return sourceWord(row.source);
                case 'medium':
                  return row.medium === '' ? '—' : row.medium;
                case 'campaign':
                  return row.campaign === '' ? '—' : row.campaign;
                case 'visits':
                  return figure(row.visits, locale);
                case 'finishes':
                  return figure(row.finishes, locale);
                default:
                  return percent(row.finishes, row.visits, locale);
              }
            }}
          />
          {sourcesAside}
        </Card>
      </TileGrid>
    </>
  );
}

/** The funnel's one next action over mixed kinds. */
function PickKind({ onPress }: { readonly onPress: () => void }) {
  return (
    <Button variant="secondary" onPress={onPress}>
      {strings.funnelPickAction}
    </Button>
  );
}
