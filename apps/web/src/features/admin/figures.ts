// Settings › Super admin (spec 0047): the period in the address and the
// numbers as words. Pure: the locale and the server's figures come in.
import type { OperatorFigure, OperatorPeriod } from '@crm/data';
import { strings } from './strings.ts';

/** The periods a page reads, shortest first (the contract's `OPERATOR_PERIODS`). */
export const PERIODS: readonly OperatorPeriod[] = ['7d', '30d', '90d'];

/** The period a page reads when the address names none. */
export const DEFAULT_PERIOD: OperatorPeriod = '30d';

/** A console page's address: its period, kept as `?period=`. */
export interface PeriodSearch {
  readonly period?: OperatorPeriod;
}

/** The period an address names, or none (the default then applies). */
export function periodSearch(search: Record<string, unknown>): PeriodSearch {
  const period = PERIODS.find((each) => each === search['period']);
  return period === undefined || period === DEFAULT_PERIOD ? {} : { period };
}

/** The users list's address: the period and the search. */
export interface UsersSearch extends PeriodSearch {
  readonly q?: string;
}

/** The users list's address, read safely: a search of at most 100 characters. */
export function usersSearch(search: Record<string, unknown>): UsersSearch {
  const q = typeof search['q'] === 'string' ? search['q'].trim().slice(0, 100) : '';
  return { ...periodSearch(search), ...(q === '' ? {} : { q }) };
}

/** How many days a period covers. */
export const PERIOD_LENGTH: Readonly<Record<OperatorPeriod, number>> = { '7d': 7, '30d': 30, '90d': 90 };

/** Formats counts, shares and days in the reader's language. */
export function formatters(locale: string) {
  const count = new Intl.NumberFormat(locale);
  const share = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
  const ratio = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const regions =
    typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(locale, { type: 'region' }) : undefined;
  return {
    count: (value: number) => count.format(value),
    /** Bookings per visitor, as a share; None with no visitors. */
    share: (part: number, whole: number) => (whole === 0 ? strings.none : share.format(part / whole)),
    ratio: (part: number, whole: number) => (whole === 0 ? strings.none : ratio.format(part / whole)),
    /** A count, or "100,000+" past a cap it was counted to. */
    capped: (value: number, cap: number) =>
      value > cap ? strings.recordsCapped(count.format(cap)) : count.format(value),
    /** A UTC day, `YYYY-MM-DD`, as "23 Oct". */
    day: (value: string) => day.format(new Date(`${value}T00:00:00Z`)),
    /** An instant's UTC date, as "23 Oct 2026". */
    date: (value: string) => date.format(new Date(value)),
    country: (code: string) => {
      try {
        return regions?.of(code) ?? code;
      } catch {
        return code;
      }
    },
  };
}

/** The formatters for one locale. */
export type Formatters = ReturnType<typeof formatters>;

/** Which way a figure moved against the period before. */
export function trendOf(figure: OperatorFigure): 'up' | 'down' | 'same' {
  return figure.value > figure.before ? 'up' : figure.value < figure.before ? 'down' : 'same';
}

/** A figure as Stats draws it: its value, and the period before as its comparison. */
export function figureStat(
  id: string,
  label: string,
  figure: OperatorFigure,
  period: OperatorPeriod,
  format: Formatters,
) {
  return {
    id,
    label,
    value: format.count(figure.value),
    comparison: strings.period.before(format.count(figure.before), period),
    trend: trendOf(figure),
  } as const;
}

/** A rate (one figure over another) as Stats draws it, against the same rate the period before. */
export function rateStat(
  id: string,
  label: string,
  part: OperatorFigure,
  whole: OperatorFigure,
  period: OperatorPeriod,
  format: (part: number, whole: number) => string,
) {
  const value = format(part.value, whole.value);
  const before = format(part.before, whole.before);
  const now = whole.value === 0 ? 0 : part.value / whole.value;
  const then = whole.before === 0 ? 0 : part.before / whole.before;
  return {
    id,
    label,
    value,
    comparison: strings.period.before(before, period),
    // No arrow with nothing to compare against, nor between two figures that read the same.
    trend: whole.before === 0 || value === before ? 'same' : now > then ? 'up' : now < then ? 'down' : 'same',
  } as const;
}

/** A plain figure as Stats draws it, with nothing to compare. */
export function plainStat(id: string, label: string, value: string, comparison?: string) {
  return { id, label, value, ...(comparison === undefined ? {} : { comparison }) } as const;
}

/** A role's word, or the stored role as written. */
export function roleLabel(role: string): string {
  return strings.roles[role] ?? role;
}

/** A booking page's kind, as the app names it. */
export function kindLabel(kind: string): string {
  return strings.kinds[kind] ?? kind;
}

/** A booking page's state, as the app names it. */
export function stateLabel(state: string): string {
  return strings.states[state] ?? state;
}
