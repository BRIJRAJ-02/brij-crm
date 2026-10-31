// Brief
// Purpose: what a pipeline report adds to its bars: the open pipeline, what is won, and a weighted forecast.
// Main task: set each open stage's chance of closing, and read the forecast move.
// Leaves out: a chance stored on the stage itself (the options editor has no place for it yet), forecasts by month
//   or owner, and anything for a report that isn't a sum per stage.
import type { ReportConfig, ReportFigures } from '@crm/data';
import { forecastOf } from '@crm/contracts/reports';
import { Disclosure, Field, Stats } from '@crm/ui';
import type { Formats } from './format.ts';
import { strings } from './strings.ts';

/** The chances (0 to 100) by stage option. */
type Weights = NonNullable<ReportConfig['weights']>;

/** Props for Forecast. */
export interface ForecastProps {
  readonly figures: ReportFigures;
  readonly weights: Weights | undefined;
  readonly formats: Formats;
  /** Whether the person may change the report, and so its chances. */
  readonly canEdit: boolean;
  readonly onWeights: (weights: Weights | undefined) => void;
}

/** Won stages count in full and lost ones not at all, so only an open stage has a chance to set. */
const isOpen = (outcome: 'open' | 'won' | 'lost' | undefined) => outcome !== 'won' && outcome !== 'lost';

/** The pipeline's arithmetic, and the stages' chances to set. */
export function Forecast({ figures, weights, formats, canEdit, onWeights }: ForecastProps) {
  const stages = figures.points.filter((point) => typeof point.id === 'string' && isOpen(point.outcome));
  const forecast = forecastOf(
    figures.points.map((point) => ({ id: point.id, value: point.value, outcome: point.outcome })),
    weights ?? {},
  );
  const items = [
    { id: 'open', label: strings.openPipeline, value: formats.value(forecast.open) },
    ...(forecast.won > 0 ? [{ id: 'won', label: strings.wonTotal, value: formats.value(forecast.won) }] : []),
    ...(forecast.weighted === undefined
      ? []
      : [{ id: 'forecast', label: strings.forecast, value: formats.value(forecast.weighted) }]),
  ];
  const setChance = (id: string, text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, 3);
    const others = Object.entries(weights ?? {}).filter(([key]) => key !== id);
    const next = digits === '' ? others : [...others, [id, Math.min(100, Number(digits))] as const];
    onWeights(next.length === 0 ? undefined : Object.fromEntries(next));
  };
  return (
    <>
      <Stats label={strings.forecast} items={items} />
      {canEdit && stages.length > 0 && (
        <Disclosure title={strings.winChances} defaultExpanded={forecast.weighted === undefined}>
          {stages.map((point) => (
            <Field
              key={String(point.id)}
              label={strings.winChance(point.label ?? '')}
              value={weights?.[String(point.id)]?.toString() ?? ''}
              inputMode="numeric"
              suffix={strings.percent}
              align="end"
              onChange={(text) => {
                setChance(String(point.id), text);
              }}
            />
          ))}
        </Disclosure>
      )}
    </>
  );
}
