// What a screen holds for a report's figures (the reports lane): the shapes `useReportFigures` reads, and a source
// that waits for the module that works them out. In the first load (types and one small function); the numbers
// themselves (`figures.ts`) load with the first report, never with the page's route.

/** One bar, point or number of a report, worked out. */
export interface ReportPoint {
  /** The option, member or checkbox column (`null`: no value); undefined for a period or a total. */
  readonly id?: string | null | undefined;
  /** A period's first day (`YYYY-MM-DD`), for a date group. */
  readonly start?: string | undefined;
  /** An option's or member's name; the screen words checkbox columns and "no value". */
  readonly label?: string | undefined;
  readonly hue?: string | undefined;
  readonly outcome?: 'open' | 'won' | 'lost' | undefined;
  /** The count, or the sum or average in the report's currency; zero where nothing was found. */
  readonly value: number;
  /** A count stopped at its cap: it is at least this many. */
  readonly atLeast: boolean;
}

/** A report's figures once every question is answered. */
export interface ReportFigures {
  readonly points: readonly ReportPoint[];
  readonly unit: 'count' | 'amount';
  /** The currency the amounts are in; undefined for a count or plain numbers. */
  readonly currency: string | undefined;
  /** Currencies some group holds that the chart leaves out. */
  readonly otherCurrencies: readonly string[];
  /** The records matched too many to add up (a filtered sum past 10,000): nothing is drawn rather than a part. */
  readonly tooMany: boolean;
  /** More groups than a chart draws. */
  readonly truncated: boolean;
  /** Whether any point holds something: false draws the empty state. */
  readonly hasData: boolean;
  /** Every point added, for a count or a sum; undefined for an average. */
  readonly total: number | undefined;
  /** The measure was an average. */
  readonly isAverage: boolean;
}

/** Where a report's figures stand. */
export type ReportFiguresState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly figures: ReportFigures; readonly isRefreshing: boolean };

/** A report's figures as a screen reads them (`useReportFigures`): held while shown, so they stay current. */
export interface ReportFiguresSource {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => ReportFiguresState;
  /** Holds the questions while a screen shows them; the answer lets go. */
  readonly retain: () => () => void;
  /** Asks again after a failure (Try again). */
  readonly retry: () => void;
}

const LOADING: ReportFiguresState = { status: 'loading' };

/**
 * A source that answers `loading` until the module that works the figures out has loaded, then reads its own
 * source (`load`), holding it if a screen already does.
 */
export function lazyFiguresSource(load: Promise<ReportFiguresSource>): ReportFiguresSource {
  let inner: ReportFiguresSource | undefined;
  let holders = 0;
  let releaseInner: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  void load.then(
    (source) => {
      inner = source;
      source.subscribe(emit);
      if (holders > 0) releaseInner = source.retain();
      emit();
    },
    () => undefined,
  );
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => inner?.getSnapshot() ?? LOADING,
    retain: () => {
      holders += 1;
      if (holders === 1 && inner !== undefined) releaseInner = inner.retain();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holders -= 1;
        if (holders === 0) {
          releaseInner?.();
          releaseInner = undefined;
        }
      };
    },
    retry: () => {
      inner?.retry();
    },
  };
}
