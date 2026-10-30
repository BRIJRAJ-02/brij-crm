// Home's metrics row (spec 0041): the reader's week and the figures as words.
// Pure: the day, the locale and the server's figures come in.
import type { HomeMetricsView, ObjectSummary, WeekCount, WeekMoney } from '@crm/data';
import { dayStart, weekOf } from '../bookings/week.ts';
import { formsHref } from '../forms/paths.ts';
import { bookingsHref, objectHref } from '../workspace/objects.ts';

/** The reader's week's start, their Monday's midnight, as the UTC instant the metrics read takes. */
export function weekStartOf(today: string): string {
  return dayStart(weekOf(today)).toISOString();
}

/** One figure as Stats draws it. */
export interface MetricFigure {
  readonly id: 'meetings' | 'people' | 'deals' | 'won' | 'submissions';
  readonly value: string;
  readonly lastWeek: string;
  readonly trend: 'up' | 'down' | 'same';
  /** Anything this week or last: a row of only zeros is left out. */
  readonly moved: boolean;
}

const trendOf = (now: number, before: number): MetricFigure['trend'] =>
  now > before ? 'up' : now < before ? 'down' : 'same';

/** The figures the reader may see, in the row's order; one they may not see is absent. */
export function metricFigures(metrics: HomeMetricsView, locale: string): readonly MetricFigure[] {
  const number = new Intl.NumberFormat(locale);
  const count = (id: MetricFigure['id'], figure: WeekCount | undefined): MetricFigure[] =>
    figure === undefined
      ? []
      : [
          {
            id,
            value: number.format(figure.thisWeek),
            lastWeek: number.format(figure.lastWeek),
            trend: trendOf(figure.thisWeek, figure.lastWeek),
            moved: figure.thisWeek > 0 || figure.lastWeek > 0,
          },
        ];
  const money = (figure: WeekMoney | undefined): MetricFigure[] => {
    if (figure === undefined) return [];
    const format = moneyFormat(locale, figure.currency);
    const now = Number(figure.thisWeek);
    const before = Number(figure.lastWeek);
    return [
      {
        id: 'won',
        value: format(now),
        lastWeek: format(before),
        trend: trendOf(now, before),
        moved: now > 0 || before > 0,
      },
    ];
  };
  return [
    ...count('meetings', metrics.meetings),
    ...count('people', metrics.people),
    ...count('deals', metrics.deals),
    ...money(metrics.won),
    ...count('submissions', metrics.submissions),
  ];
}

/**
 * Where a figure's records are: People's or Deals' table (Deals won too), Bookings for meetings and Forms for
 * submissions. Undefined when the object isn't one the reader has (archived, or not seen).
 */
export function metricHref(
  id: MetricFigure['id'],
  slug: string,
  objects: readonly Pick<ObjectSummary, 'apiSlug' | 'standardKey' | 'isArchived'>[],
): string | undefined {
  if (id === 'meetings') return bookingsHref(slug);
  if (id === 'submissions') return formsHref(slug);
  const key = id === 'people' ? 'people' : 'deals';
  const object = objects.find((each) => each.standardKey === key && !each.isArchived);
  return object === undefined ? undefined : objectHref(slug, object);
}

/** Whole amounts in `currency`, or the amount and its code when the browser doesn't know the code. */
function moneyFormat(locale: string, currency: string): (amount: number) => string {
  try {
    const format = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 });
    return (amount) => format.format(amount);
  } catch {
    const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    return (amount) => `${number.format(amount)} ${currency}`;
  }
}
