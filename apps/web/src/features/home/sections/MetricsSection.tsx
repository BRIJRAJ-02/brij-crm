// Home's metrics row (spec 0041): this week so far against all of last week,
// only the figures the reader may see; a quiet week says so rather than
// drawing a row of zeros.
import { useHomeMetrics } from '@crm/data/react';
import { Card, EmptyState, Stats, useFormatSettings } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useToday } from '../../tasks/day.ts';
import { metricFigures, weekStartOf } from '../metrics.ts';
import type { HomeSectionProps } from '../registry.ts';
import { strings } from '../strings.ts';
import { Failed, locale } from './shared.tsx';

/** This week: the metrics row. */
export function MetricsSection({ context }: HomeSectionProps) {
  const { slug } = context;
  const { data } = useRouteContext({ from: '__root__' });
  const { timeZone } = useFormatSettings();
  const today = useToday(timeZone);
  const weekStart = useMemo(() => weekStartOf(today), [today]);
  const view = useMemo(() => data.home.metrics(slug, weekStart), [data, slug, weekStart]);
  const state = useHomeMetrics(view);
  const figures = useMemo(() => (state.status === 'ready' ? metricFigures(state.metrics, locale()) : []), [state]);
  if (state.status === 'error') {
    return (
      <Card title={strings.thisWeek}>
        <Failed
          title={strings.metricsFailed}
          message={state.message}
          onRetry={() => {
            view.reload();
          }}
        />
      </Card>
    );
  }
  if (state.status === 'ready' && !figures.some((figure) => figure.moved)) {
    return (
      <Card title={strings.thisWeek}>
        <EmptyState icon="chart-line" title={strings.quietWeek} layout="row">
          {strings.quietWeekText}
        </EmptyState>
      </Card>
    );
  }
  const others = state.status === 'ready' && state.metrics.won?.others === true;
  return (
    <Card
      title={strings.thisWeek}
      description={strings.againstLastWeek}
      isBusy={state.status === 'loading'}
      {...(others ? { footer: strings.otherCurrencies } : {})}
    >
      <Stats
        label={strings.thisWeek}
        isLoading={state.status === 'loading'}
        items={figures.map((figure) => ({
          id: figure.id,
          label: strings.metricLabels[figure.id],
          value: figure.value,
          comparison: strings.lastWeek(figure.lastWeek),
          trend: figure.trend,
        }))}
      />
    </Card>
  );
}
