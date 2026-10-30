// A table's footer calculations and a board's column totals (the CRM flow
// pass): each column the view sets a `calc` on, or each board column, is worked out across every record the view matches, one
// `records.aggregate` read per footer cell through the data layer, never per
// row and never over the rows loaded. Asked again when the view's question
// moves or its count does (a settle after someone else's change), so 100
// people editing don't each ask on every keystroke.
import type { AggregateFn, FilterGroup, RecordAggregate } from '@crm/data';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
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

/** One calculation to read: where its answer goes, and what to work out over which filter. */
export interface AggregateAsk {
  readonly key: string;
  readonly attributeId: string;
  readonly fn: AggregateFn;
  readonly filter?: FilterGroup | undefined;
}

/**
 * Each ask's answer as words by its key, read through the data layer, one read each: absent while it is read,
 * "unavailable" when the read failed. Read again when the asks or `refreshKey` (a count) move; the answers shown
 * stay until the next ones are in.
 */
export function useAggregates(
  slug: string,
  objectId: string,
  asks: readonly AggregateAsk[],
  refreshKey: string,
): ReadonlyMap<string, string> {
  const { data } = useRouteContext({ from: '__root__' });
  const key = JSON.stringify([objectId, asks, refreshKey]);
  const [values, setValues] = useState<ReadonlyMap<string, string>>(() => new Map());
  useEffect(() => {
    if (asks.length === 0) return undefined;
    const abort = new AbortController();
    void Promise.all(
      asks.map(async (ask) => {
        try {
          const answer = await data.records.aggregate(
            slug,
            objectId,
            { attributeId: ask.attributeId, fn: ask.fn, ...(ask.filter === undefined ? {} : { filter: ask.filter }) },
            abort.signal,
          );
          return [ask.key, formatAggregate(answer, ask.fn)] as const;
        } catch {
          return [ask.key, strings.calcFailed] as const;
        }
      }),
    ).then((answers) => {
      if (!abort.signal.aborted) setValues(new Map(answers));
    });
    return () => {
      abort.abort();
    };
    // `key` is the question: the object, every ask and the refresh key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, slug, key]);
  return values;
}

/** Each calculated column's value by column id, over the view's filter; `countKey` moves when its count does. */
export function useColumnCalcs(
  slug: string,
  objectId: string,
  filter: FilterGroup | undefined,
  columns: readonly { readonly id: string; readonly calc?: AggregateFn }[],
  countKey: string,
): ReadonlyMap<string, string> {
  const asks = useMemo(
    () =>
      columns.flatMap((column) =>
        column.calc === undefined ? [] : [{ key: column.id, attributeId: column.id, fn: column.calc, filter }],
      ),
    [columns, filter],
  );
  return useAggregates(slug, objectId, asks, countKey);
}
