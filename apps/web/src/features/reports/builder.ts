// The report builder's rules, pure: an object's attributes as the report rules read them, the draft a first visit
// draws, each control's change to a report's settings (a change that would not run leaves them as they were), the
// name a draft gets until the person chooses one, and whether a draft differs from what is saved.
import type { AttributeDefinition, ObjectSummary, ReportConfig } from '@crm/data';
import type { FilterGroup } from '@crm/contracts/values';
import {
  defaultReport,
  groupChoices,
  groupKeyOfConfig,
  measurableAttributes,
  pipelineReport,
  reportProblem,
  type GroupChoice,
  type ReportAttribute,
} from '@crm/contracts/reports';
import { strings } from './strings.ts';

/** An object's attributes as the report rules read them. */
export function reportAttributesOf(definitions: readonly AttributeDefinition[]): readonly ReportAttribute[] {
  return definitions.map((definition) => ({
    id: definition.id,
    type: definition.type,
    isMulti: definition.isMulti,
    isSystem: definition.isSystem,
    isPrimary: definition.isPrimary,
    isArchived: definition.isArchived,
    position: definition.position,
    apiSlug: definition.apiSlug,
    title: definition.title,
    ...(definition.options === undefined
      ? {}
      : {
          options: definition.options.map((option) => ({
            id: option.id,
            label: option.label,
            hue: option.hue,
            position: option.position,
            isArchived: option.isArchived,
            outcome: option.outcome,
          })),
        }),
  }));
}

/** What the builder holds for one report, saved or not. */
export interface ReportDraft {
  readonly objectId: string;
  readonly name: string;
  /** The person typed the name: it stops following the settings. */
  readonly isNameChosen: boolean;
  readonly config: ReportConfig;
  /** The filter select: `all`, a view's id, or `kept` (the filter a saved report carries). */
  readonly filterChoice: string;
}

/** The settings an object starts with: its pipeline by stage when it has a stage and a value, else its first group counted. */
export function startingConfig(attributes: readonly ReportAttribute[]): ReportConfig {
  return pipelineReport(attributes) ?? defaultReport(attributes);
}

/** A new draft on one object. */
export function draftOn(
  object: Pick<ObjectSummary, 'id' | 'pluralName'>,
  attributes: readonly ReportAttribute[],
): ReportDraft {
  const config = startingConfig(attributes);
  return {
    objectId: object.id,
    name: autoName(object.pluralName, attributes, config),
    isNameChosen: false,
    config,
    filterChoice: 'all',
  };
}

/**
 * The first visit's draft: the first object that has a pipeline to show (a stage and a value), else the first
 * object, so a first report is already drawn.
 */
export function firstDraft(
  objects: readonly Pick<ObjectSummary, 'id' | 'pluralName'>[],
  attributesOf: (objectId: string) => readonly ReportAttribute[],
): ReportDraft | undefined {
  const withPipeline = objects.find((object) => pipelineReport(attributesOf(object.id)) !== undefined);
  const object = withPipeline ?? objects[0];
  return object === undefined ? undefined : draftOn(object, attributesOf(object.id));
}

/** A saved report as a draft. */
export function draftOfReport(report: {
  readonly objectId: string;
  readonly name: string;
  readonly config: ReportConfig;
}): ReportDraft {
  return {
    objectId: report.objectId,
    name: report.name,
    isNameChosen: true,
    config: report.config,
    filterChoice: report.config.filter === undefined ? 'all' : 'kept',
  };
}

// ---- the controls --------------------------------------------------------

/** One entry of the measure select. */
export interface MeasureChoice {
  readonly key: string;
  readonly label: string;
}

/** The measures an object offers: a count, then a sum and an average of each number or currency field. */
export function measureChoices(attributes: readonly ReportAttribute[]): readonly MeasureChoice[] {
  return [
    { key: 'count', label: strings.count },
    ...measurableAttributes(attributes).flatMap((attribute) => [
      { key: `sum:${attribute.id}`, label: strings.sumOf(attribute.title) },
      { key: `avg:${attribute.id}`, label: strings.avgOf(attribute.title) },
    ]),
  ];
}

/** The key of the choice a config's measure is. */
export function measureKeyOf(config: ReportConfig): string {
  return config.measure.fn === 'count' ? 'count' : `${config.measure.fn}:${config.measure.attributeId}`;
}

/** The config with the measure `key` names, or as it was when it names none. */
export function withMeasure(config: ReportConfig, key: string): ReportConfig {
  if (key === 'count') return { ...config, measure: { fn: 'count' } };
  const [fn, attributeId] = key.split(':');
  if ((fn !== 'sum' && fn !== 'avg') || attributeId === undefined) return config;
  return { ...config, measure: { fn, attributeId } };
}

/** The group select's words for a choice, reading on from the measure: "by stage", "by month", "by close date, week". */
export function groupLabel(choice: GroupChoice, attributes: readonly ReportAttribute[]): string {
  const title = choice.title.toLowerCase();
  if (choice.bucket === undefined) return strings.groupedBy(title);
  const period = (choice.bucket === 'month' ? strings.month : strings.week).toLowerCase();
  // When the record was made is the usual date: "by month". Any other date names itself.
  const isMade = attributes.find((each) => each.id === choice.attributeId)?.isSystem === true;
  return isMade ? strings.groupedBy(period) : strings.groupedByPeriod(title, period);
}

/** Without the weights a stage's chance was typed for: they belong to the field they were set on. */
function withoutWeights(config: ReportConfig): ReportConfig {
  const { weights: _weights, ...rest } = config;
  return rest;
}

/**
 * The config grouped by the choice `key` names (`none` for a total). A date is drawn as a line, anything else as
 * bars, and a total as a number; a key that names no choice leaves the config as it was.
 */
export function withGroup(config: ReportConfig, key: string, attributes: readonly ReportAttribute[]): ReportConfig {
  const { groupBy: _groupBy, ...rest } = config;
  if (key === 'none') return withoutWeights({ ...rest, chart: 'number' });
  const choice = groupChoices(attributes).find((each) => each.key === key);
  if (choice === undefined) return config;
  const groupBy =
    choice.bucket === undefined
      ? { attributeId: choice.attributeId }
      : { attributeId: choice.attributeId, bucket: choice.bucket };
  const kept = config.groupBy?.attributeId === choice.attributeId ? rest : withoutWeights(rest);
  return { ...kept, groupBy, chart: choice.bucket === undefined ? 'bar' : 'line' };
}

/**
 * The config with the filter a saved view runs, and that view's name for the label; without a filter, none. The
 * filter is a snapshot: the report keeps what the view ran when it was picked.
 */
export function withFilter(
  config: ReportConfig,
  filter: FilterGroup | undefined,
  name: string | undefined,
): ReportConfig {
  const { filter: _filter, filterName: _filterName, ...rest } = config;
  return filter === undefined || filter.conditions.length === 0
    ? rest
    : { ...rest, filter, ...(name === undefined ? {} : { filterName: name }) };
}

/** The charts an object can draw: bars need a field to group by, a line a date, a number nothing. */
export function chartsFor(attributes: readonly ReportAttribute[]): readonly ReportConfig['chart'][] {
  const choices = groupChoices(attributes);
  return [
    ...(choices.some((choice) => choice.bucket === undefined) ? (['bar'] as const) : []),
    ...(choices.some((choice) => choice.bucket !== undefined) ? (['line'] as const) : []),
    'number',
  ];
}

/** The config drawn as `chart`: a group by it can use is kept or chosen first; one that can't run leaves it as it was. */
export function withChart(
  config: ReportConfig,
  chart: ReportConfig['chart'],
  attributes: readonly ReportAttribute[],
): ReportConfig {
  if (chart === 'number') {
    const { groupBy: _groupBy, ...rest } = config;
    return withoutWeights({ ...rest, chart });
  }
  const wantsDate = chart === 'line';
  const kept = config.groupBy !== undefined && (config.groupBy.bucket !== undefined) === wantsDate;
  if (kept) return { ...config, chart };
  const choice = groupChoices(attributes).find((each) => (each.bucket !== undefined) === wantsDate);
  if (choice === undefined) return config;
  return withGroup({ ...config, chart }, choice.key, attributes);
}

/** A name for a draft until the person chooses one: what is counted or summed, and how it is grouped ("Deals by stage"). */
export function autoName(pluralName: string, attributes: readonly ReportAttribute[], config: ReportConfig): string {
  const byId = new Map(attributes.map((each) => [each.id, each]));
  const what = config.measure.fn === 'count' ? pluralName : (byId.get(config.measure.attributeId)?.title ?? pluralName);
  const { groupBy } = config;
  const group = groupBy === undefined ? undefined : byId.get(groupBy.attributeId);
  if (groupBy === undefined || group === undefined || config.chart === 'number') return what;
  if (groupBy.bucket === undefined) return `${what} ${strings.by} ${group.title.toLowerCase()}`;
  const period = groupBy.bucket === 'month' ? strings.month : strings.week;
  // When the record was made is the usual date; any other names itself.
  return group.isSystem
    ? `${what} ${strings.by} ${period.toLowerCase()}`
    : `${what} ${strings.by} ${group.title.toLowerCase()}, ${period.toLowerCase()}`;
}

/** Whether the config runs on these attributes (the server's rule). */
export function isRunnable(config: ReportConfig, attributes: readonly ReportAttribute[]): boolean {
  return reportProblem(config, attributes) === undefined;
}

/** The group select's current key. */
export const groupKeyOf = groupKeyOfConfig;

// ---- the draft against what is saved --------------------------------------

/** A value as JSON with every object's keys in order, so two spellings of one config compare equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${(value as unknown[]).map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).filter(([, each]) => each !== undefined);
    return `{${entries
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, each]) => `${JSON.stringify(key)}:${canonical(each)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Whether two reports (object, name and settings) are the same. */
export function sameReport(
  a: { readonly objectId: string; readonly name: string; readonly config: ReportConfig },
  b: { readonly objectId: string; readonly name: string; readonly config: ReportConfig },
): boolean {
  return a.objectId === b.objectId && a.name.trim() === b.name.trim() && canonical(a.config) === canonical(b.config);
}

/** A stable text for a set of questions, so a source is made again only when they change. */
export function keyOfQuestions(questions: unknown): string {
  return canonical(questions);
}
