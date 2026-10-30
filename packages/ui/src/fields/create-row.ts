// A record picker's last row, which makes the record searched for when the
// search found none by that name: "Create "<typed>"", or "Create company…"
// when the far object asks for more than a name and a form has to open.
// Plain, so the rule (when it shows) is tested in Node.
import type { ListSource } from '../lib/list-source.ts';
import { strings } from './strings.ts';

/** What a picker offers to make, besides its results. */
export interface CreateOffer {
  /**
   * The far object's name for one record, lower case ("company"), when a name
   * alone can't make one: the row reads "Create company…" whatever is typed,
   * and choosing it opens the screen's full form.
   */
  readonly formNoun?: string;
}

/** The create row itself: what was typed, and whether it opens a form. */
export interface CreateRow {
  readonly createRow: true;
  readonly label: string;
  readonly formNoun?: string;
}

/** The create row's key, apart from every record's. */
export const CREATE_ROW_KEY = '\u0000create';

/** Whether a menu item is the create row. */
export const isCreateRow = (item: object): item is CreateRow => 'createRow' in item;

/** What the create row reads: "Create "Acme"", or "Create company…". */
export const createRowText = (row: CreateRow): string =>
  row.formNoun === undefined ? strings.createNamed(row.label) : strings.createIn(row.formNoun);

/**
 * The create row for what is typed, or nothing: never while the search is
 * still out (a row loading), never for a blank search unless it opens a
 * form, and never when a result already has that name, ignoring case and the
 * spaces around it.
 */
export function createRowFor<D>(
  results: ListSource<D> | undefined,
  query: string,
  nameOf: (item: D) => string,
  offer: CreateOffer | undefined,
): CreateRow | undefined {
  if (offer === undefined || results === undefined) return undefined;
  const label = query.trim();
  const items = Array.from({ length: results.count }, (_, index) => results.getItem(index));
  if (items.some((item) => item === undefined)) return undefined;
  if (offer.formNoun !== undefined) return { createRow: true, label, formNoun: offer.formNoun };
  if (label === '') return undefined;
  const wanted = label.toLocaleLowerCase();
  const taken = items.some((item) => item !== undefined && nameOf(item).trim().toLocaleLowerCase() === wanted);
  return taken ? undefined : { createRow: true, label };
}

/** The results with the create row last, when there is one. */
export function withCreateRow<D extends object>(
  results: ListSource<D>,
  row: CreateRow | undefined,
): ListSource<D | CreateRow> {
  const extra = row === undefined ? 0 : 1;
  return {
    count: results.count + extra,
    getItem: (index) => (row !== undefined && index === results.count ? row : results.getItem(index)),
    getKey: (item) => (isCreateRow(item) ? CREATE_ROW_KEY : results.getKey(item)),
    ...(results.onRangeChange === undefined
      ? {}
      : {
          onRangeChange: ({ start, end }) => {
            results.onRangeChange?.({ start: Math.min(start, results.count), end: Math.min(end, results.count) });
          },
        }),
  };
}
