// Brief
// Purpose: one report's figures drawn: its chart, the notes under it, and a pipeline's forecast.
// Main task: read the numbers, and switch the chart to its table.
// Leaves out: changing the report (the toolbar's job) and saving it; the figures themselves, which the data layer
//   asks of the access door.
import type { ReportConfig, ReportFiguresSource } from '@crm/data';
import { useReportFigures } from '@crm/data/react';
import type { ReportPlan } from '@crm/contracts/reports';
import { Callout, useFormatSettings } from '@crm/ui';
import { Chart } from '@crm/ui/charts';
import { useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { chartPointsOf, formatsFor } from './format.ts';
import { Forecast } from './Forecast.tsx';
import { strings } from './strings.ts';

/** Props for ReportBody. The screen gives it a `key` made of the plan's questions, so a new plan is a new body. */
export interface ReportBodyProps {
  readonly slug: string;
  readonly plan: ReportPlan | undefined;
  readonly config: ReportConfig;
  /** The report's name: the chart's. */
  readonly name: string;
  /** What a count counts ("Deals"), or the measure's field. */
  readonly valueLabel: string;
  /** The group by field's title ("Stage"); undefined for a total. */
  readonly groupTitle: string | undefined;
  /** The filter is still being read from the view just picked. */
  readonly isPending: boolean;
  /** A pipeline: a sum per stage of a status, which a forecast reads. */
  readonly isPipeline: boolean;
  readonly canEdit: boolean;
  readonly onWeights: (weights: ReportConfig['weights']) => void;
}

/** A plan that couldn't be made asks nothing: the report names a field this reader can't see. */
const NO_PLAN_STATUS = 'no-access';

/** The chart for a plan, with the notes under it and a pipeline's forecast. */
export function ReportBody({
  slug,
  plan,
  config,
  name,
  valueLabel,
  groupTitle,
  isPending,
  isPipeline,
  canEdit,
  onWeights,
}: ReportBodyProps) {
  const { data } = useRouteContext({ from: '__root__' });
  const { locale } = useFormatSettings();
  // One source per body: the screen keys the body by its questions, so a changed report is a new source.
  const [source] = useState(() => (plan === undefined ? undefined : data.reports.figures(slug, plan)));
  const held = useReportFigures(source ?? NO_FIGURES);
  const state = source === undefined ? undefined : held;
  const figures = state?.status === 'ready' ? state.figures : undefined;
  const formats = formatsFor(locale, plan?.unit ?? 'count', figures?.currency);
  const bucket = config.groupBy?.bucket;
  const points = figures === undefined ? [] : chartPointsOf(figures, bucket, { locale, groupTitle }, formats);
  const status =
    plan === undefined
      ? NO_PLAN_STATUS
      : isPending || state === undefined || state.status === 'loading'
        ? 'loading'
        : state.status === 'error'
          ? 'error'
          : 'ready';
  const pointLabel =
    bucket === 'month' ? strings.month : bucket === 'week' ? strings.week : (groupTitle ?? strings.total);
  return (
    <>
      <Chart
        kind={config.chart}
        label={name}
        pointLabel={pointLabel}
        valueLabel={valueLabel}
        points={points}
        formatTick={formats.tick}
        status={status}
        isRefreshing={state?.status === 'ready' && state.isRefreshing}
        {...(source === undefined ? {} : { onRetry: source.retry })}
      />
      {figures !== undefined && figures.tooMany && <Callout tone="warning">{strings.tooMany}</Callout>}
      {figures !== undefined && figures.otherCurrencies.length > 0 && (
        <Callout>{strings.othersLeftOut(figures.otherCurrencies)}</Callout>
      )}
      {figures !== undefined && figures.truncated && <Callout>{strings.truncated}</Callout>}
      {isPipeline && figures !== undefined && !figures.tooMany && (
        <Forecast
          figures={figures}
          weights={config.weights}
          formats={formats}
          canEdit={canEdit}
          onWeights={onWeights}
        />
      )}
    </>
  );
}

/** The state of a source that asks nothing: the hook still needs one when there is no plan. */
const LOADING = { status: 'loading' } as const;

/** A source that asks nothing, for the hook when there is no plan. */
const NO_FIGURES: ReportFiguresSource = {
  subscribe: () => () => undefined,
  getSnapshot: () => LOADING,
  retain: () => () => undefined,
  retry: () => undefined,
};
