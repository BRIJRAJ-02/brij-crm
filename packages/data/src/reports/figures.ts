// A report's figures (the reports lane), loaded with the first report: the plan's questions asked through the
// records layer's calculations store (`data.records.aggregates`, one `records.aggregate` or
// `records.aggregateGroups` each, through the access door and the read gate), and their answers worked into bars,
// points or one number. The store already reads a question again when a record it depends on changes, so a report
// on screen stays current with no code of its own here. Pure apart from the sources it is handed.
import type { RecordAggregate } from '@crm/contracts';
import { mainCurrency, type ReportPlan, type ReportQuestion } from '@crm/contracts/reports';
import { aggregateKey, type AggregateSource, type AggregateState } from '../records/aggregate-source.ts';
import type { ReportFigures, ReportFiguresSource, ReportFiguresState, ReportPoint } from './figures-source.ts';

/** A figure as a number: the engine answers exact decimals as text, and a chart only needs them as numbers. */
const numberOf = (text: string | undefined): number => {
  const value = Number(text);
  return Number.isFinite(value) ? value : 0;
};

/**
 * The figures a plan's answers make: one point per slice, in the plan's order. A count is the answer's count (at
 * its cap, `atLeast`), a sum or an average the amount in the currency most groups hold (the others are named and
 * left out), zero where a group holds nothing.
 */
export function figuresOf(
  plan: ReportPlan,
  answers: readonly (ReadonlyMap<string, RecordAggregate> | undefined)[],
): ReportFigures {
  const asked = plan.slices.map((slice) => {
    const grouped = slice.groupId !== undefined;
    const key = grouped
      ? aggregateKey(slice.attributeId, slice.fn, slice.groupId)
      : aggregateKey(slice.attributeId, slice.fn);
    return { slice, answer: answers[slice.question]?.get(key) };
  });
  const currencies =
    plan.unit === 'amount'
      ? mainCurrency(asked.map(({ answer }) => (answer?.amounts ?? []).map((each) => each.currency)))
      : undefined;
  const main = currencies?.main;
  const tooMany = asked.some(({ answer }) => answer?.tooMany === true);
  const points = asked.map(({ slice, answer }): ReportPoint => {
    const shape = {
      ...(slice.id === undefined ? {} : { id: slice.id }),
      ...(slice.start === undefined ? {} : { start: slice.start }),
      ...(slice.label === undefined ? {} : { label: slice.label }),
      ...(slice.hue === undefined ? {} : { hue: slice.hue }),
      ...(slice.outcome === undefined ? {} : { outcome: slice.outcome }),
    };
    if (plan.unit === 'count') {
      return { ...shape, value: answer?.count ?? 0, atLeast: answer?.atLeast === true };
    }
    const amount = (answer?.amounts ?? []).find((each) => each.currency === main);
    return { ...shape, value: numberOf(amount?.value), atLeast: false };
  });
  const isAverage = asked[0]?.slice.fn === 'avg';
  return {
    points,
    unit: plan.unit,
    currency: main,
    otherCurrencies: currencies?.others ?? [],
    tooMany,
    truncated: plan.truncated,
    hasData: !tooMany && points.some((point) => point.value !== 0),
    total: isAverage ? undefined : points.reduce((sum, point) => sum + point.value, 0),
    isAverage,
  };
}

/** The state a plan's questions' states make: an error if any failed, loading until each has answers, else ready. */
export function stateOf(plan: ReportPlan, states: readonly AggregateState[]): ReportFiguresState {
  if (states.some((state) => state.status === 'error')) return { status: 'error' };
  if (states.length === 0 || states.some((state) => state.answers === undefined)) return { status: 'loading' };
  return {
    status: 'ready',
    figures: figuresOf(
      plan,
      states.map((state) => state.answers),
    ),
    isRefreshing: states.some((state) => state.isRefreshing === true),
  };
}

/**
 * A plan's figures as a source: each question held through `open` (the records layer's calculations store, which
 * shares one answer between screens asking the same question), the state worked out once per change, and the same
 * object handed back while nothing moved, so a screen re-renders only when its figures do.
 */
export function createFiguresSource(
  plan: ReportPlan,
  open: (question: ReportQuestion) => AggregateSource,
): ReportFiguresSource {
  const sources = plan.questions.map((question) => open(question));
  let seen: readonly AggregateState[] | undefined;
  let state: ReportFiguresState = { status: 'loading' };
  const current = (): ReportFiguresState => {
    const now = sources.map((source) => source.getSnapshot());
    if (seen !== undefined && now.every((each, index) => each === seen?.[index])) return state;
    seen = now;
    state = stateOf(plan, now);
    return state;
  };
  const releases: (() => void)[] = [];
  let holders = 0;
  return {
    subscribe: (listener) => {
      const offs = sources.map((source) => source.subscribe(listener));
      return () => {
        for (const off of offs) off();
      };
    },
    getSnapshot: current,
    retain: () => {
      holders += 1;
      if (holders === 1) releases.push(...sources.map((source) => source.retain()));
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holders -= 1;
        if (holders === 0) {
          for (const release of releases.splice(0)) release();
        }
      };
    },
    // A question that failed reads again when it is held again: hold each anew, then let the old hold go.
    retry: () => {
      if (holders === 0) return;
      const again = sources.map((source) => source.retain());
      for (const release of releases.splice(0)) release();
      releases.push(...again);
    },
  };
}
