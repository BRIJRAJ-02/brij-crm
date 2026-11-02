// Brief
// Purpose: Routing › Insights (spec 0037, AC-1376, AC-1386, AC-1389): whether smart routing is learning yet, whether it is working, and how each rep is doing.
// Main task: read one team page's objective rate against the holdout, then open a segment and see each rep's meetings, rate, lift and share.
// Leaves out: changing anything (every setting is on Smart), one meeting's own explanation (Decisions), and any figure the nightly run hasn't counted.
import { WARM_TRIALS } from '@crm/data/forms';
import type { DataLayer, InsightsCell, InsightsMember, InsightsPage, RoutingObjective } from '@crm/data';
import { useRoutingInsights } from '@crm/data/react';
import {
  Badge,
  Callout,
  Card,
  DescriptionList,
  EmptyState,
  memoIntl,
  SectionBar,
  Select,
  Skeleton,
  Stats,
  Table,
  TruncatedText,
  useFormatSettings,
  type TableColumn,
} from '@crm/ui';
import { useMemo, useState } from 'react';
import { insightsStrings as strings } from './insights-strings.ts';

/** Props for InsightsTab. */
export interface InsightsTabProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The window the comparison counts over, in weeks; absent is the whole learning window. */
  readonly weeks?: number;
  readonly onWeeks: (weeks: number | undefined) => void;
}

/**
 * The rep columns for one page's objective: the rate column names what it is a rate **of**, so a scan of the table
 * is self-contained rather than needing the card's description above it.
 *
 * No `fill` on the row header: in a scrollable table a filling column may collapse to nothing (it is capped at 0
 * and truncates), and at 390 that left a row of numbers with no rep beside them.
 */
function columnsFor(objective: RoutingObjective): readonly TableColumn[] {
  return [
    { id: 'rep', label: strings.rep, isRowHeader: true, isInline: true },
    { id: 'trials', label: strings.trials, align: 'end', size: 'fit' },
    { id: 'rate', label: strings.rateOf(strings.objectives[objective]), align: 'end', size: 'fit' },
    { id: 'lift', label: strings.lift, align: 'end', size: 'fit' },
    { id: 'share', label: strings.share, align: 'end', size: 'fit' },
    { id: 'marks', label: strings.markingRate, align: 'end', size: 'fit' },
  ];
}

/**
 * Which way the comparison went (AC-1389). `isCertain` only says the two intervals are apart, so on its own it
 * would state a page where the ranking is **hurting** as confidently, and as greenly, as one where it helps.
 */
function verdictOf(page: InsightsPage): 'ahead' | 'behind' | 'unsure' {
  if (!page.isCertain) return 'unsure';
  return page.changed.rate >= page.holdout.rate ? 'ahead' : 'behind';
}

/** One empty list, so the table's rows never change identity while a cell loads. */
const NO_MEMBERS: readonly InsightsMember[] = [];

/** The windows the strip offers: the whole learning window, then shorter ones. */
const WINDOWS = [undefined, 4, 12, 26] as const;

/** Routing › Insights. */
export function InsightsTab({ data, slug, weeks, onWeeks }: InsightsTabProps) {
  const held = useMemo(() => data.routing.insights(slug, weeks), [data, slug, weeks]);
  const state = useRoutingInsights(held);
  const { locale } = useFormatSettings();
  // One formatter per locale, not one per cell: a page may hold a rep row per segment per rotation.
  const percent = (value: number) =>
    memoIntl(
      `insights-percent:${locale}`,
      () => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }),
    ).format(value);
  const count = (value: number) =>
    memoIntl(`insights-count:${locale}`, () => new Intl.NumberFormat(locale)).format(value);
  if (state.status === 'error') {
    return (
      <EmptyState tone="error" title={strings.loadFailed} onRetry={() => held.reload()}>
        {state.message === '' ? strings.loadFailedText : state.message}
      </EmptyState>
    );
  }
  const insights = state.status === 'ready' ? state.value : undefined;
  const isLoading = state.status === 'loading';
  return (
    <>
      <SectionBar
        start={
          <Select
            label={strings.window}
            size="sm"
            items={WINDOWS.map((each) => ({
              id: each === undefined ? 'all' : String(each),
              label: each === undefined ? strings.wholeWindow : strings.weeks(each),
            }))}
            value={weeks === undefined ? 'all' : String(weeks)}
            onChange={(id) => {
              const found = WINDOWS.find((each) => (each === undefined ? 'all' : String(each)) === id);
              onWeeks(found);
            }}
          />
        }
      />
      <Card title={strings.learning} isBusy={isLoading}>
        {isLoading ? (
          <Skeleton shape="block" />
        ) : insights === undefined || insights.modelVersion === 0 ? (
          <EmptyState icon="sparkles" title={strings.neverRan}>
            {strings.neverRanText}
          </EmptyState>
        ) : (
          <>
            <DescriptionList
              layout="stacked"
              items={[
                ...(insights.modelTrainedAt === undefined
                  ? []
                  : [{ term: strings.trainedAt, description: insights.modelTrainedAt.slice(0, 10) }]),
                {
                  term: strings.segmentsBy,
                  description:
                    insights.segmentAttributes.length === 0
                      ? strings.noSegments
                      : insights.segmentAttributes.map((each) => each.name).join(' · '),
                },
                ...(insights.learnSince === undefined
                  ? []
                  : [{ term: strings.learnSince, description: strings.learnSinceValue(insights.learnSince) }]),
                ...(insights.teamMarkingRate === undefined
                  ? []
                  : [
                      {
                        term: strings.markingRate,
                        description: strings.teamMarking(percent(insights.teamMarkingRate)),
                      },
                    ]),
              ]}
            />
            {insights.segmentsRestarted && <Callout tone="warning">{strings.segmentsRestarted}</Callout>}
          </>
        )}
      </Card>
      {isLoading ? (
        <Skeleton shape="block" />
      ) : // Nothing learned yet: the Learning card above already says so, and the server sends no pages at all, so
      // a pages block here would tell a workspace with six team pages that it has none.
      insights === undefined || insights.modelVersion === 0 ? null : insights.pages.length === 0 ? (
        <Card title={strings.comparison}>
          <EmptyState icon="git-branch" title={strings.noPages}>
            {strings.noPagesText}
          </EmptyState>
        </Card>
      ) : (
        insights.pages.map((page) => <PageCard key={page.pageId} page={page} percent={percent} count={count} />)
      )}
    </>
  );
}

/** One team page: its objective, the comparison, and a segment's reps. */
function PageCard({
  page,
  percent,
  count,
}: {
  readonly page: InsightsPage;
  readonly percent: (value: number) => string;
  readonly count: (value: number) => string;
}) {
  const [segment, setSegment] = useState<string | undefined>();
  const cell: InsightsCell | undefined =
    page.cells.find((each) => `${each.rotationId}:${each.segmentKey}` === segment) ?? page.cells[0];
  const hasArms = page.changed.trials + page.leftAlone.trials + page.holdout.trials > 0;
  return (
    <Card
      title={page.name}
      description={`${strings.objective}: ${strings.objectives[page.objective]}`}
      // Nothing to say when no ranked meeting has been decided in the window: a "0 meetings" badge beside
      // "Learning from 221 finished meetings" reads as a contradiction.
      {...(page.ranked === 0 ? {} : { actions: <Badge text={strings.ranked(page.ranked)} /> })}
    >
      {hasArms ? (
        <>
          <Stats
            label={strings.comparison}
            items={[
              {
                id: 'changed',
                label: strings.changed,
                value: percent(page.changed.rate),
                comparison: strings.arm(page.changed.trials),
              },
              {
                id: 'left',
                label: strings.leftAlone,
                value: percent(page.leftAlone.rate),
                comparison: strings.arm(page.leftAlone.trials),
              },
              {
                id: 'holdout',
                label: strings.holdout,
                // Nothing held back is no measurement, not a result: a 0% here would read as "without the ranking
                // we close nothing".
                value: page.holdout.trials === 0 ? '—' : percent(page.holdout.rate),
                comparison: strings.arm(page.holdout.trials),
              },
            ]}
          />
          {page.holdout.trials === 0 ? (
            <Callout tone="info">{strings.noHoldout}</Callout>
          ) : (
            <Callout tone={verdictOf(page) === 'ahead' ? 'success' : verdictOf(page) === 'behind' ? 'warning' : 'info'}>
              {strings.verdict(percent(page.changed.rate), percent(page.holdout.rate), verdictOf(page))}
            </Callout>
          )}
        </>
      ) : (
        <Callout tone="info">{strings.noComparison}</Callout>
      )}
      {page.cells.length === 0 ? (
        <EmptyState icon="sparkles" title={strings.noCells}>
          {strings.noCellsText}
        </EmptyState>
      ) : (
        <>
          <SectionBar
            start={
              <Select
                label={strings.segment}
                size="sm"
                items={page.cells.map((each) => ({
                  id: `${each.rotationId}:${each.segmentKey}`,
                  label: each.rotationName === '' ? each.label : `${each.rotationName} · ${each.label}`,
                }))}
                value={cell === undefined ? null : `${cell.rotationId}:${cell.segmentKey}`}
                onChange={(id) => setSegment(id ?? undefined)}
              />
            }
            end={
              cell === undefined ? undefined : (
                <Badge tone={cell.isWarm ? 'accent' : 'neutral'} text={cell.isWarm ? strings.warm : strings.cold} />
              )
            }
          />
          {cell !== undefined && !cell.isWarm && (
            <Callout tone="info">
              {`${strings.startsAfter(WARM_TRIALS, cell.trials, cell.waiting, cell.readyFrom)} ${strings.coldHint}`}
            </Callout>
          )}
          {cell !== undefined && cell.isWarm && <Callout tone="success">{strings.learningOn(cell.trials)}</Callout>}
          <Table
            label={strings.cellsTable}
            columns={columnsFor(page.objective)}
            rows={cell?.members ?? NO_MEMBERS}
            getRowId={(member) => member.memberId}
            // On a phone the six columns don't fit side by side: the rows scroll across.
            isScrollable
            emptyState={
              <EmptyState icon="users" title={strings.noCells}>
                {strings.noCellsText}
              </EmptyState>
            }
            renderCell={(member, column) => {
              switch (column) {
                case 'rep':
                  return <TruncatedText>{member.name}</TruncatedText>;
                case 'trials':
                  return count(member.trials);
                case 'rate':
                  return percent(member.rate);
                case 'lift':
                  return member.lift === undefined ? '—' : strings.points(member.lift);
                case 'share':
                  return strings.shareOf(percent(member.share), percent(member.fairShare));
                default:
                  return member.markingRate === undefined ? '—' : percent(member.markingRate);
              }
            }}
          />
          <Callout tone="info">{`${strings.smoothed} ${strings.cellsNote}`}</Callout>
        </>
      )}
    </Card>
  );
}
