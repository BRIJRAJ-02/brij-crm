// A table's footer calculations and a board's column totals (the CRM flow
// pass): worked out across every record the view matches, never over the rows
// loaded. Both read the data layer's calculations store
// (`data.records.aggregates`): a footer is one read for every calculated
// column, a board one read for every column's total. The store reads again
// after a change that may move them and keeps the last answers on screen
// meanwhile, so screens never decide when to ask.
import {
  aggregateKey,
  NO_AGGREGATES,
  type AggregateAskSpec,
  type AggregateFn,
  type AggregateQuestion,
  type AggregateState,
  type FilterGroup,
  type RecordAggregate,
} from '@crm/data';
import { useAggregates } from '@crm/data/react';
import { useRouteContext } from '@tanstack/react-router';
import { useMemo } from 'react';
import { strings } from './strings.ts';

/** The most currencies a footer names before "and N more". */
const SHOWN_CURRENCIES = 2;

/** A calculation's answer as the footer reads it: "1,204", "10,000+", "$42,300", "$1,200 · €300". */
export function formatAggregate(answer: RecordAggregate, fn: AggregateFn, locale?: string): string {
  if (answer.tooMany === true) return strings.calcTooMany;
  if (fn === 'count' || fn === 'count_empty') {
    const count = (answer.count ?? 0).toLocaleString(locale);
    return answer.atLeast === true ? `${count}+` : count;
  }
  const amounts = answer.amounts ?? [];
  if (amounts.length === 0) return strings.calcNothing;
  const shown = amounts.slice(0, SHOWN_CURRENCIES).map((each) => {
    const value = Number(each.value);
    if (each.currency === undefined) return value.toLocaleString(locale, { maximumFractionDigits: 4 });
    try {
      return value.toLocaleString(locale, { style: 'currency', currency: each.currency, maximumFractionDigits: 2 });
    } catch {
      return `${each.currency} ${value.toLocaleString(locale)}`;
    }
  });
  const more = amounts.length - shown.length;
  return more > 0 ? strings.calcMore(shown.join(' · '), more) : shown.join(' · ');
}

/**
 * The asks of a view's calculated columns, in a stable order (by attribute, then calculation), so moving a column
 * never changes the question and asks nothing again.
 */
export function columnAsks(
  columns: readonly { readonly id: string; readonly calc?: AggregateFn }[],
): readonly AggregateAskSpec[] {
  return columns
    .flatMap((column) => (column.calc === undefined ? [] : [{ attributeId: column.id, fn: column.calc }]))
    .sort((left, right) => {
      const a = `${left.attributeId}:${left.fn}`;
      const b = `${right.attributeId}:${right.fn}`;
      return a < b ? -1 : a > b ? 1 : 0;
    });
}

/** One answer as words: absent while the first read is out, "unavailable" when the read failed. */
function wordsOf(state: AggregateState, key: string, fn: AggregateFn): string | undefined {
  if (state.status === 'error') return strings.calcFailed;
  const answer = state.answers?.get(key);
  return answer === undefined ? undefined : formatAggregate(answer, fn);
}

/** A question's answers from the data layer, through the same source while the question is the same (`key`). */
function useAggregateSource(slug: string, key: string, question: AggregateQuestion | undefined): AggregateState {
  const { data } = useRouteContext({ from: '__root__' });
  const source = useMemo(
    () => (question === undefined ? NO_AGGREGATES : data.records.aggregates(slug, question)),
    // `key` spells the question: a new object with the same asks must not open another source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, slug, key],
  );
  return useAggregates(source);
}

/** Each calculated column's words by column id, across every record the view's filter matches. */
export function useColumnCalcs(
  slug: string,
  objectId: string,
  filter: FilterGroup | undefined,
  columns: readonly { readonly id: string; readonly calc?: AggregateFn }[],
): ReadonlyMap<string, string> {
  const asks = useMemo(() => columnAsks(columns), [columns]);
  const key = JSON.stringify([objectId, filter ?? null, asks]);
  const state = useAggregateSource(slug, key, asks.length === 0 ? undefined : { objectId, filter, asks });
  return useMemo(
    () =>
      new Map(
        asks.flatMap((ask) => {
          const words = wordsOf(state, aggregateKey(ask.attributeId, ask.fn), ask.fn);
          return words === undefined ? [] : [[ask.attributeId, words] as const];
        }),
      ),
    [asks, state],
  );
}

/**
 * Each board column's total of `totalId` by column id (`null`: the no value column), in one read for every column
 * of the board, under the view's filter.
 */
export function useBoardTotals(
  slug: string,
  objectId: string,
  filter: FilterGroup | undefined,
  groupBy: string,
  columnIds: readonly (string | null)[],
  totalId: string | undefined,
): (columnId: string | null) => string | undefined {
  const key = JSON.stringify([objectId, filter ?? null, groupBy, columnIds, totalId ?? null]);
  const state = useAggregateSource(
    slug,
    key,
    totalId === undefined || columnIds.length === 0
      ? undefined
      : { objectId, filter, asks: [{ attributeId: totalId, fn: 'sum' }], groupBy, groupIds: columnIds },
  );
  return (columnId) =>
    totalId === undefined ? undefined : wordsOf(state, aggregateKey(totalId, 'sum', columnId), 'sum');
}
