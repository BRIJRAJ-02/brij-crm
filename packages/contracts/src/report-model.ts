// `@crm/contracts/reports` (the reports lane, spec 0050 reserved): the rules a saved report shares between the
// browser and the engine. Plain TypeScript with no Zod, so the data layer and the Reports screen use them without
// loading the schema library: which attributes a report may measure and group by, the check a stored config passes
// (`reportProblem`), the defaults a first report gets (`defaultReport`, `pipelineReport`), the questions a report
// asks `records.aggregate` and `records.aggregateGroups` (`planReport`), the periods a date group draws
// (`periodStarts`, `bucketFilter`), and the forecast arithmetic (`forecastOf`). Every figure still comes from the
// engine through the access door; nothing here reads data.
import {
  BOARD_MAX_COLUMNS,
  CHECKBOX_COLUMNS,
  groupableAttributes,
  groupCondition,
  groupKindOf,
  type BoardAttribute,
  type GroupKind,
} from './board-model.ts';
import type { ReportConfig } from './reports.ts';
import type { AggregateFn } from './values/aggregates.ts';
import type { FilterCondition, FilterGroup } from './values/filters.ts';

/** The charts a report draws: bars per group, a line over periods, or one big number. */
export const REPORT_CHARTS = ['bar', 'line', 'number'] as const;
/** One chart. */
export type ReportChart = (typeof REPORT_CHARTS)[number];

/** The periods a date group draws. */
export const REPORT_BUCKETS = ['month', 'week'] as const;
/** One period. */
export type ReportBucket = (typeof REPORT_BUCKETS)[number];

/** How many periods a date group draws: the last twelve, this one included. */
export const REPORT_PERIODS = 12;

/** The most groups a chart draws (a status's first stages by position, or members): each count is one read. */
export const REPORT_MAX_GROUPS = 12;

/** What a report needs to know of an attribute: the board's facts, its names, and its options. */
export interface ReportAttribute extends BoardAttribute {
  readonly apiSlug: string;
  readonly title: string;
  readonly options?: readonly {
    readonly id: string;
    readonly label: string;
    readonly hue: string;
    readonly position: number;
    readonly isArchived: boolean;
    readonly outcome?: 'open' | 'won' | 'lost' | undefined;
  }[];
}

const isDateType = (type: string): boolean => type === 'date' || type === 'timestamp';

/** The attributes a sum or an average reads: numbers and currency holding one value. */
export function measurableAttributes<T extends ReportAttribute>(attributes: readonly T[]): readonly T[] {
  return attributes
    .filter((each) => !each.isArchived && !each.isMulti && (each.type === 'number' || each.type === 'currency'))
    .sort((a, b) => a.position - b.position);
}

/** One way to group: an attribute, and for a date its period. */
export interface GroupChoice {
  readonly attributeId: string;
  readonly bucket?: ReportBucket;
  readonly title: string;
  /** Stable for a select: the attribute's id, and `:month` or `:week` for a date. */
  readonly key: string;
}

/** The dates a report groups by: its own date fields, then when the record was made. */
function dateAttributes<T extends ReportAttribute>(attributes: readonly T[]): readonly T[] {
  const live = attributes.filter((each) => !each.isArchived && !each.isMulti && isDateType(each.type));
  const own = live.filter((each) => !each.isSystem).sort((a, b) => a.position - b.position);
  return [...own, ...live.filter((each) => each.isSystem && each.apiSlug === 'created_at')];
}

/** The ways an object can be grouped: statuses, single selects, members and checkboxes, then each date by month and week. */
export function groupChoices(attributes: readonly ReportAttribute[]): readonly GroupChoice[] {
  const plain = groupableAttributes(attributes).map((each): GroupChoice => ({
    attributeId: each.id,
    title: each.title,
    key: each.id,
  }));
  const dates = dateAttributes(attributes).flatMap((each) =>
    REPORT_BUCKETS.map((bucket): GroupChoice => ({
      attributeId: each.id,
      bucket,
      title: each.title,
      key: `${each.id}:${bucket}`,
    })),
  );
  return [...plain, ...dates];
}

/** The key of the choice a config's group by names; `none` when it has no group. */
export function groupKeyOfConfig(config: Pick<ReportConfig, 'groupBy'>): string {
  const { groupBy } = config;
  if (groupBy === undefined) return 'none';
  return groupBy.bucket === undefined ? groupBy.attributeId : `${groupBy.attributeId}:${groupBy.bucket}`;
}

/** The attribute a count reads: every record has a created at, so counting it counts the records. */
export function countAttributeOf(attributes: readonly ReportAttribute[]): ReportAttribute | undefined {
  return (
    attributes.find((each) => each.isSystem && each.apiSlug === 'created_at') ??
    attributes.find((each) => each.isPrimary)
  );
}

/**
 * Why a config can't run on these attributes (the object's, as the reader sees them), in a sentence, or undefined
 * when it can: the server refuses with it as `CONFIG_INVALID`, and the screen never builds one that fails it.
 */
export function reportProblem(config: ReportConfig, attributes: readonly ReportAttribute[]): string | undefined {
  const byId = new Map(attributes.map((each) => [each.id, each]));
  const { measure, groupBy, chart } = config;
  if (measure.fn !== 'count') {
    const measured = byId.get(measure.attributeId);
    if (measured === undefined || !measurableAttributes(attributes).includes(measured)) {
      return 'A sum or an average reads a number or currency field of this object.';
    }
  }
  if (countAttributeOf(attributes) === undefined) return 'This object has nothing to count.';
  if (groupBy !== undefined) {
    const grouped = byId.get(groupBy.attributeId);
    if (grouped === undefined) return 'The group by is not a field of this object.';
    if (groupBy.bucket === undefined) {
      if (groupKindOf(grouped) === undefined) return 'Group by a status, a select, a member or a checkbox field.';
    } else if (grouped.isArchived || grouped.isMulti || !isDateType(grouped.type)) {
      return 'Group by month or week needs a date field.';
    }
  }
  if (chart === 'line' && groupBy?.bucket === undefined) return 'A line needs a date to group by.';
  if (chart === 'bar' && groupBy === undefined) return 'Bars need a field to group by.';
  return undefined;
}

/**
 * The report a first visit draws: the object counted by its first status (or select, member, checkbox) as bars,
 * else a count as one number.
 */
export function defaultReport(attributes: readonly ReportAttribute[]): ReportConfig {
  const first = groupableAttributes(attributes)[0];
  return first === undefined
    ? { measure: { fn: 'count' }, chart: 'number' }
    : { measure: { fn: 'count' }, groupBy: { attributeId: first.id }, chart: 'bar' };
}

/** Pipeline by stage: the first value field summed per stage. Undefined when the object has no status or no value field. */
export function pipelineReport(attributes: readonly ReportAttribute[]): ReportConfig | undefined {
  const stage = groupableAttributes(attributes).find((each) => each.type === 'status');
  const values = measurableAttributes(attributes);
  const value = values.find((each) => each.type === 'currency') ?? values[0];
  if (stage === undefined || value === undefined) return undefined;
  return {
    measure: { fn: 'sum', attributeId: value.id },
    groupBy: { attributeId: stage.id },
    chart: 'bar',
  };
}

// ---- days and periods -----------------------------------------------------

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Milliseconds since the epoch of a `YYYY-MM-DD` day's midnight in UTC. */
function utcOf(day: string): number {
  const found = DAY.exec(day);
  if (found === null) throw new RangeError(`Not a day: ${day}`);
  return Date.UTC(Number(found[1]), Number(found[2]) - 1, Number(found[3]));
}

const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** A day moved by `days` (negative goes back). */
export function addDays(day: string, days: number): string {
  return dayOf(utcOf(day) + days * 86_400_000);
}

/** The reader's calendar day at `instant` (an ISO instant) in `timeZone`. */
export function localDay(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((each) => each.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** The day a week can start on. */
export type WeekDay = 'monday' | 'sunday' | 'saturday';

/** Each week start as `Date#getUTCDay` numbers it. */
const WEEK_STARTS: Readonly<Record<WeekDay, number>> = { sunday: 0, monday: 1, saturday: 6 };

/** The first day of the period that holds `day`. A week starts on `weekStart`. */
export function periodStartOf(bucket: ReportBucket, day: string, weekStart: WeekDay): string {
  if (bucket === 'month') return `${day.slice(0, 7)}-01`;
  const weekday = new Date(utcOf(day)).getUTCDay();
  const back = (weekday - WEEK_STARTS[weekStart] + 7) % 7;
  return addDays(day, -back);
}

/** The day after a period ends (exclusive): the next month's first day, or seven days on. */
export function periodEndOf(bucket: ReportBucket, start: string): string {
  if (bucket === 'week') return addDays(start, 7);
  const [year, month] = [Number(start.slice(0, 4)), Number(start.slice(5, 7))];
  return month === 12 ? `${String(year + 1)}-01-01` : `${String(year)}-${String(month + 1).padStart(2, '0')}-01`;
}

/** The starts of the last `count` periods, oldest first, the one that holds `today` last. */
export function periodStarts(
  bucket: ReportBucket,
  today: string,
  weekStart: WeekDay,
  count: number = REPORT_PERIODS,
): readonly string[] {
  const starts: string[] = [];
  let start = periodStartOf(bucket, today, weekStart);
  for (let n = 0; n < count; n += 1) {
    starts.unshift(start);
    // The day before this period starts holds the one before.
    start = periodStartOf(bucket, addDays(start, -1), weekStart);
  }
  return starts;
}

/** The offset of `timeZone` from UTC at an instant, in milliseconds. */
function offsetAt(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const part = (type: string) => Number(parts.find((each) => each.type === type)?.value ?? '0');
  const local = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return local - Math.floor(ms / 1000) * 1000;
}

/** The instant (ISO, UTC) a day begins at in `timeZone`. */
export function instantOfDay(day: string, timeZone: string): string {
  const guess = utcOf(day);
  const first = guess - offsetAt(guess, timeZone);
  const second = guess - offsetAt(first, timeZone);
  return new Date(second).toISOString();
}

/**
 * The period `[start, end)` as a filter on a date or timestamp attribute. The engine's `after` and `before` are
 * strict, so a day is "after the day before" and a moment "after the millisecond before".
 */
export function bucketFilter(
  attribute: Pick<ReportAttribute, 'id' | 'type'>,
  start: string,
  end: string,
  timeZone: string,
): readonly FilterCondition[] {
  if (attribute.type === 'date') {
    return [
      { attributeId: attribute.id, operator: 'after', value: addDays(start, -1) },
      { attributeId: attribute.id, operator: 'before', value: end },
    ];
  }
  const from = new Date(Date.parse(instantOfDay(start, timeZone)) - 1).toISOString();
  return [
    { attributeId: attribute.id, operator: 'after', value: from },
    { attributeId: attribute.id, operator: 'before', value: instantOfDay(end, timeZone) },
  ];
}

/** A filter with more conditions and-ed on: an "and" filter takes them in its own group, so nesting never grows. */
export function withConditions(filter: FilterGroup | undefined, conditions: readonly FilterCondition[]): FilterGroup {
  if (filter === undefined || filter.conditions.length === 0)
    return { conjunction: 'and', conditions: [...conditions] };
  if (filter.conjunction === 'and') return { conjunction: 'and', conditions: [...filter.conditions, ...conditions] };
  return { conjunction: 'and', conditions: [filter, ...conditions] };
}

// ---- the plan -------------------------------------------------------------

/** One question a report asks the engine: `records.aggregate`, or with `groupBy` `records.aggregateGroups`. */
export interface ReportQuestion {
  readonly objectId: string;
  readonly filter?: FilterGroup;
  readonly asks: readonly { readonly attributeId: string; readonly fn: AggregateFn }[];
  readonly groupBy?: string;
  readonly groupIds?: readonly (string | null)[];
}

/** One bar, point or number of a report, and where its answer sits. */
export interface ReportSlice {
  /** The option, member or checkbox column; null for no value. Undefined for a period or a total. */
  readonly id?: string | null;
  /** A period's first day (`YYYY-MM-DD`), for a date group. */
  readonly start?: string;
  /** An option's or member's name; the screen words checkbox columns and "no value". */
  readonly label?: string;
  readonly hue?: string;
  readonly outcome?: 'open' | 'won' | 'lost' | undefined;
  /** The question holding its answer, in `ReportPlan.questions`. */
  readonly question: number;
  readonly attributeId: string;
  readonly fn: AggregateFn;
  /** The column the answer sits under when the question is grouped. */
  readonly groupId?: string | null;
}

/** What a config asks the engine, worked out for the reader's attributes, members and clock. */
export interface ReportPlan {
  /** `amount` for a sum or average (money or plain numbers), `count` for a count. */
  readonly unit: 'count' | 'amount';
  readonly measureAttributeId?: string;
  readonly questions: readonly ReportQuestion[];
  readonly slices: readonly ReportSlice[];
  /** More groups than a chart draws: the screen says so. */
  readonly truncated: boolean;
  /** How the groups are made, when the chart is grouped by a field and not a date. */
  readonly groupKind?: GroupKind;
}

/** What a plan needs besides the config: the reader's attributes and members, and the clock. */
export interface ReportContext {
  readonly objectId: string;
  readonly attributes: readonly ReportAttribute[];
  readonly members: readonly { readonly id: string; readonly name: string }[];
  /** The clock, an ISO instant. */
  readonly now: string;
  readonly timeZone: string;
  readonly weekStart: WeekDay;
}

/** A plan, or the sentence saying why the config can't run. */
export type PlanResult = { readonly plan: ReportPlan } | { readonly problem: string };

/**
 * The questions a report asks. A count per group is one `records.aggregate` per group (its own filter), a sum or
 * average per group is one `records.aggregateGroups`, a date group is one `records.aggregate` per period, and one
 * number is one question. Through the access door every time: a field the reader can't see makes the engine refuse.
 */
export function planReport(config: ReportConfig, context: ReportContext): PlanResult {
  const problem = reportProblem(config, context.attributes);
  if (problem !== undefined) return { problem };
  const { measure, groupBy, filter } = config;
  const byId = new Map(context.attributes.map((each) => [each.id, each]));
  const counter = countAttributeOf(context.attributes);
  if (counter === undefined) return { problem: 'This object has nothing to count.' };
  const ask =
    measure.fn === 'count'
      ? { attributeId: counter.id, fn: 'count' as const }
      : { attributeId: measure.attributeId, fn: measure.fn };
  const unit = measure.fn === 'count' ? 'count' : 'amount';
  const base = { unit, ...(measure.fn === 'count' ? {} : { measureAttributeId: measure.attributeId }) } as const;
  const withFilter = (extra: FilterGroup | undefined) => (extra === undefined ? {} : { filter: extra });
  const noFilter = filter !== undefined && filter.conditions.length > 0 ? filter : undefined;

  if (groupBy === undefined || config.chart === 'number') {
    return {
      plan: {
        ...base,
        questions: [{ objectId: context.objectId, ...withFilter(noFilter), asks: [ask] }],
        slices: [{ question: 0, attributeId: ask.attributeId, fn: ask.fn }],
        truncated: false,
      },
    };
  }

  const grouped = byId.get(groupBy.attributeId);
  if (grouped === undefined) return { problem: 'The group by is not a field of this object.' };

  if (groupBy.bucket !== undefined) {
    const bucket = groupBy.bucket;
    const today = localDay(context.now, context.timeZone);
    const starts = periodStarts(bucket, today, context.weekStart);
    return {
      plan: {
        ...base,
        questions: starts.map((start) => ({
          objectId: context.objectId,
          filter: withConditions(noFilter, bucketFilter(grouped, start, periodEndOf(bucket, start), context.timeZone)),
          asks: [ask],
        })),
        slices: starts.map((start, question) => ({ start, question, attributeId: ask.attributeId, fn: ask.fn })),
        truncated: false,
      },
    };
  }

  const kind = groupKindOf(grouped);
  if (kind === undefined) return { problem: 'Group by a status, a select, a member or a checkbox field.' };
  const columns = columnsOf(kind, grouped, context.members);
  const shown = columns.items.slice(0, REPORT_MAX_GROUPS);
  const noValue = NO_VALUE_COLUMN[kind];
  const slices = noValue === undefined ? shown : [...shown, noValue];
  const truncated = columns.items.length > REPORT_MAX_GROUPS;
  if (measure.fn === 'count') {
    return {
      plan: {
        ...base,
        groupKind: kind,
        questions: slices.map((column) => ({
          objectId: context.objectId,
          filter: withConditions(noFilter, [groupCondition(grouped.id, column.id, kind)]),
          asks: [ask],
        })),
        slices: slices.map((column, question) => ({
          ...sliceOf(column),
          question,
          attributeId: ask.attributeId,
          fn: ask.fn,
        })),
        truncated,
      },
    };
  }
  return {
    plan: {
      ...base,
      groupKind: kind,
      questions: [
        {
          objectId: context.objectId,
          ...withFilter(noFilter),
          asks: [ask],
          groupBy: grouped.id,
          groupIds: slices.map((column) => column.id),
        },
      ],
      slices: slices.map((column) => ({
        ...sliceOf(column),
        question: 0,
        attributeId: ask.attributeId,
        fn: ask.fn,
        groupId: column.id,
      })),
      truncated,
    },
  };
}

/** One column a group by makes. */
interface Column {
  readonly id: string | null;
  readonly label?: string | undefined;
  readonly hue?: string | undefined;
  readonly outcome?: 'open' | 'won' | 'lost' | undefined;
}

const sliceOf = (column: Column) => ({
  id: column.id,
  ...(column.label === undefined ? {} : { label: column.label }),
  ...(column.hue === undefined ? {} : { hue: column.hue }),
  ...(column.outcome === undefined ? {} : { outcome: column.outcome }),
});

/** The column for records with no value, last: a checkbox has none, an empty one is Not checked. */
const NO_VALUE_COLUMN: Readonly<Record<GroupKind, Column | undefined>> = {
  option: { id: null },
  member: { id: null },
  checkbox: undefined,
};

/** The columns of a grouping attribute, in the order a chart draws them. */
function columnsOf(
  kind: GroupKind,
  attribute: ReportAttribute,
  members: ReportContext['members'],
): { readonly items: readonly Column[] } {
  if (kind === 'checkbox') return { items: CHECKBOX_COLUMNS.map((id): Column => ({ id })) };
  if (kind === 'member') return { items: members.map((member): Column => ({ id: member.id, label: member.name })) };
  const options = [...(attribute.options ?? [])]
    .filter((option) => !option.isArchived)
    .sort((a, b) => a.position - b.position)
    .slice(0, BOARD_MAX_COLUMNS);
  return {
    items: options.map((option): Column => ({
      id: option.id,
      label: option.label,
      hue: option.hue,
      outcome: option.outcome,
    })),
  };
}

// ---- the forecast ---------------------------------------------------------

/** A stage's value and what it is worth: its outcome, and the chance (0 to 100) a person set on it. */
export interface ForecastStage {
  readonly id: string | null | undefined;
  readonly value: number;
  readonly outcome?: 'open' | 'won' | 'lost' | undefined;
}

/** The pipeline's arithmetic: what is open, what is won, and what the open stages are worth at their chances. */
export interface Forecast {
  /** Open stages added up (a stage with no outcome counts as open). */
  readonly open: number;
  /** Won stages added up. */
  readonly won: number;
  /** Won plus each open stage at its chance; undefined while no open stage has one. */
  readonly weighted: number | undefined;
}

/**
 * Pipeline arithmetic over the stages of a "sum per stage" report. Won counts in full and lost not at all; an open
 * stage counts at the chance in `weights` (by option id), and `weighted` is undefined until one open stage has one,
 * so a forecast is never claimed from nothing.
 */
export function forecastOf(stages: readonly ForecastStage[], weights: Readonly<Record<string, number>>): Forecast {
  let open = 0;
  let won = 0;
  let expected = 0;
  let anyChance = false;
  for (const stage of stages) {
    if (stage.outcome === 'won') {
      won += stage.value;
    } else if (stage.outcome !== 'lost') {
      open += stage.value;
      const chance = typeof stage.id === 'string' ? weights[stage.id] : undefined;
      if (chance !== undefined) {
        anyChance = true;
        expected += (stage.value * chance) / 100;
      }
    }
  }
  return { open, won, weighted: anyChance ? won + expected : undefined };
}

/**
 * The currency a chart draws in: the one most groups hold an amount in (the first seen on a tie), and the others
 * left out. `[]` for plain numbers.
 */
export function mainCurrency(groups: readonly (readonly (string | undefined)[])[]): {
  readonly main: string | undefined;
  readonly others: readonly string[];
} {
  const held = new Map<string, number>();
  for (const codes of groups) {
    for (const code of new Set(codes)) {
      if (code !== undefined) held.set(code, (held.get(code) ?? 0) + 1);
    }
  }
  const ranked = [...held.entries()].sort((a, b) => b[1] - a[1]);
  return { main: ranked[0]?.[0], others: ranked.slice(1).map(([code]) => code) };
}
