// A report's figures as the chart's words: a count or an amount as text (in the reader's language and the report's
// currency), an axis tick as short text, and each bar or point named: an option or member by its name, "No stage"
// for none, a period by its month or week. The chart formats nothing itself, so this is the one place it is done.
import type { ReportFigures, ReportPoint } from '@crm/data';
import type { ChartPoint } from '@crm/ui/charts';
import { strings } from './strings.ts';

/** How a report writes its numbers. */
export interface Formats {
  /** A point's value in full ("$12,400", "38", "10,000+"). */
  readonly value: (value: number, atLeast?: boolean) => string;
  /** An axis tick, short ("$10K"). */
  readonly tick: (value: number) => string;
}

/** The number formats for a count, plain numbers, or an amount in `currency`. */
export function formatsFor(locale: string, unit: 'count' | 'amount', currency: string | undefined): Formats {
  const money = currency === undefined ? undefined : ({ style: 'currency', currency } as const);
  const full = new Intl.NumberFormat(locale, unit === 'count' ? {} : { maximumFractionDigits: 2, ...money });
  const rounded =
    unit === 'amount' && money !== undefined
      ? new Intl.NumberFormat(locale, { ...money, maximumFractionDigits: 0 })
      : full;
  const short = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1, ...money });
  return {
    value: (value, atLeast = false) => {
      const text = (Number.isInteger(value) ? rounded : full).format(value);
      return atLeast ? strings.atLeast(text) : text;
    },
    tick: (value) => short.format(value),
  };
}

/** How the groups were made, for naming the empty one. */
export interface GroupContext {
  readonly locale: string;
  /** The group by field's title ("Stage"): "No stage" names the records with none. */
  readonly groupTitle: string | undefined;
}

/** `YYYY-MM-DD` as a date in UTC, so a period's first day reads the same in every zone. */
const dayOf = (start: string): Date => new Date(`${start}T00:00:00Z`);

/** A point's names: in full for the tooltip and the table, and short for the axis when it differs. */
export function namesOf(
  point: ReportPoint,
  bucket: 'month' | 'week' | undefined,
  { locale, groupTitle }: GroupContext,
): { readonly label: string; readonly axisLabel?: string } {
  if (point.start !== undefined) {
    const day = dayOf(point.start);
    const zone = { timeZone: 'UTC' } as const;
    if (bucket === 'week') {
      return {
        label: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', ...zone }).format(
          day,
        ),
        axisLabel: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', ...zone }).format(day),
      };
    }
    return {
      label: new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', ...zone }).format(day),
      axisLabel: new Intl.DateTimeFormat(locale, { month: 'short', ...zone }).format(day),
    };
  }
  if (point.id === 'checked') return { label: strings.checked };
  if (point.id === 'unchecked') return { label: strings.unchecked };
  if (point.id === null) return { label: strings.noValue(groupTitle ?? '') };
  return { label: point.label ?? strings.total };
}

/** The figures as the chart's points, each named and worded. */
export function chartPointsOf(
  figures: ReportFigures,
  bucket: 'month' | 'week' | undefined,
  context: GroupContext,
  formats: Formats,
): readonly ChartPoint[] {
  return figures.points.map((point, index) => {
    const names = namesOf(point, bucket, context);
    return {
      id: point.start ?? (point.id === undefined ? `total-${String(index)}` : (point.id ?? 'none')),
      label: names.label,
      ...(names.axisLabel === undefined ? {} : { axisLabel: names.axisLabel }),
      value: point.value,
      valueText: formats.value(point.value, point.atLeast),
    };
  });
}
