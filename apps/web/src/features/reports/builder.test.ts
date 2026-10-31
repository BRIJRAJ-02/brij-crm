import type { ReportConfig } from '@crm/data';
import { groupChoices, type ReportAttribute } from '@crm/contracts/reports';
import { describe, expect, it } from 'vitest';
import {
  autoName,
  chartsFor,
  draftOn,
  draftOfReport,
  firstDraft,
  groupLabel,
  isRunnable,
  measureChoices,
  measureKeyOf,
  sameReport,
  startingConfig,
  withChart,
  withGroup,
  withMeasure,
} from './builder.ts';

const attribute = (over: Partial<ReportAttribute> & Pick<ReportAttribute, 'id' | 'type'>): ReportAttribute => ({
  apiSlug: over.id,
  title: over.id,
  isMulti: false,
  isSystem: false,
  isPrimary: false,
  isArchived: false,
  position: 0,
  ...over,
});

const DEALS: readonly ReportAttribute[] = [
  attribute({ id: 'name', type: 'text', title: 'Name', isPrimary: true }),
  attribute({ id: 'stage', type: 'status', title: 'Stage', position: 1 }),
  attribute({ id: 'value', type: 'currency', title: 'Value', position: 2 }),
  attribute({ id: 'closes', type: 'date', title: 'Close date', position: 3 }),
  attribute({
    id: 'created',
    type: 'timestamp',
    title: 'Created at',
    isSystem: true,
    apiSlug: 'created_at',
    position: 4,
  }),
];

const PEOPLE: readonly ReportAttribute[] = [
  attribute({ id: 'name', type: 'text', title: 'Name', isPrimary: true }),
  attribute({
    id: 'created',
    type: 'timestamp',
    title: 'Created at',
    isSystem: true,
    apiSlug: 'created_at',
    position: 4,
  }),
];

const PIPELINE: ReportConfig = {
  measure: { fn: 'sum', attributeId: 'value' },
  groupBy: { attributeId: 'stage' },
  chart: 'bar',
};

describe('the first draft', () => {
  it('starts on the object with a pipeline, as its pipeline by stage', () => {
    const attributesOf = (id: string) => (id === 'deals' ? DEALS : PEOPLE);
    const draft = firstDraft(
      [
        { id: 'people', pluralName: 'People' },
        { id: 'deals', pluralName: 'Deals' },
      ],
      attributesOf,
    );
    expect(draft).toMatchObject({ objectId: 'deals', name: 'Value by stage', config: PIPELINE, filterChoice: 'all' });
    expect(draft?.isNameChosen).toBe(false);
  });

  it('falls back to the first object, counted, and to nothing without objects', () => {
    const draft = firstDraft([{ id: 'people', pluralName: 'People' }], () => PEOPLE);
    expect(draft?.config).toEqual({ measure: { fn: 'count' }, chart: 'number' });
    expect(draft?.name).toBe('People');
    expect(firstDraft([], () => PEOPLE)).toBeUndefined();
  });

  it('counts by the first group when there is a stage but no value', () => {
    const stageOnly = DEALS.filter((each) => each.id !== 'value');
    expect(startingConfig(stageOnly)).toEqual({
      measure: { fn: 'count' },
      groupBy: { attributeId: 'stage' },
      chart: 'bar',
    });
  });

  it('opens a saved report as it was, with its kept filter', () => {
    const filter = {
      conjunction: 'and' as const,
      conditions: [{ attributeId: 'value', operator: 'gt' as const, value: 1 }],
    };
    const draft = draftOfReport({
      objectId: 'deals',
      name: 'Big',
      config: { ...PIPELINE, filter, filterName: 'Big deals' },
    });
    expect(draft).toMatchObject({ isNameChosen: true, filterChoice: 'kept' });
    expect(draftOfReport({ objectId: 'deals', name: 'All', config: PIPELINE }).filterChoice).toBe('all');
  });
});

describe('the controls', () => {
  it('offers a count, then a sum and an average of each value field', () => {
    expect(measureChoices(DEALS)).toEqual([
      { key: 'count', label: 'Count' },
      { key: 'sum:value', label: 'Sum of Value' },
      { key: 'avg:value', label: 'Average of Value' },
    ]);
    expect(measureChoices(PEOPLE)).toEqual([{ key: 'count', label: 'Count' }]);
  });

  it('changes the measure by key, and ignores a key that names nothing', () => {
    expect(measureKeyOf(PIPELINE)).toBe('sum:value');
    expect(withMeasure(PIPELINE, 'count').measure).toEqual({ fn: 'count' });
    expect(withMeasure(PIPELINE, 'avg:value').measure).toEqual({ fn: 'avg', attributeId: 'value' });
    expect(withMeasure(PIPELINE, 'min:value')).toBe(PIPELINE);
    expect(withMeasure(PIPELINE, 'sum')).toBe(PIPELINE);
  });

  it('draws a date group as a line and any other as bars, and a total as a number', () => {
    expect(withGroup(PIPELINE, 'closes:month', DEALS)).toEqual({
      measure: { fn: 'sum', attributeId: 'value' },
      groupBy: { attributeId: 'closes', bucket: 'month' },
      chart: 'line',
    });
    expect(withGroup({ ...PIPELINE, chart: 'line' }, 'stage', DEALS).chart).toBe('bar');
    expect(withGroup(PIPELINE, 'none', DEALS)).toEqual({
      measure: { fn: 'sum', attributeId: 'value' },
      chart: 'number',
    });
    expect(withGroup(PIPELINE, 'gone', DEALS)).toBe(PIPELINE);
  });

  it('drops the win chances when the stage field changes', () => {
    const weighted: ReportConfig = { ...PIPELINE, weights: { 'a-stage': 40 } };
    expect(withGroup(weighted, 'closes:week', DEALS).weights).toBeUndefined();
    expect(withGroup(weighted, 'stage', DEALS).weights).toEqual({ 'a-stage': 40 });
  });

  it('switches the chart to a group it can use, or stays as it was', () => {
    expect(withChart(PIPELINE, 'line', DEALS).groupBy).toEqual({ attributeId: 'closes', bucket: 'month' });
    expect(withChart(withChart(PIPELINE, 'line', DEALS), 'bar', DEALS).groupBy).toEqual({ attributeId: 'stage' });
    expect(withChart(PIPELINE, 'number', DEALS)).toEqual({
      measure: { fn: 'sum', attributeId: 'value' },
      chart: 'number',
    });
    const counted: ReportConfig = { measure: { fn: 'count' }, chart: 'number' };
    // People has no field to group by except when it was made: bars have nothing to draw by.
    expect(withChart(counted, 'bar', PEOPLE)).toBe(counted);
    expect(withChart(counted, 'line', PEOPLE).groupBy).toEqual({ attributeId: 'created', bucket: 'month' });
  });

  it('lists only the charts an object can draw', () => {
    expect(chartsFor(DEALS)).toEqual(['bar', 'line', 'number']);
    expect(chartsFor(PEOPLE)).toEqual(['line', 'number']);
  });

  it('words each choice to read on from the measure', () => {
    const wording = (key: string) =>
      groupChoices(DEALS)
        .filter((each) => each.key === key)
        .map((each) => groupLabel(each, DEALS));
    expect(wording('stage')).toEqual(['by stage']);
    expect(wording('closes:week')).toEqual(['by close date, week']);
    expect(wording('created:month')).toEqual(['by month']);
  });

  it('knows a config that runs from one that does not', () => {
    expect(isRunnable(PIPELINE, DEALS)).toBe(true);
    expect(isRunnable({ measure: { fn: 'count' }, chart: 'bar' }, DEALS)).toBe(false);
  });
});

describe('names and changes', () => {
  it('names a draft by what it counts and how it is grouped', () => {
    expect(
      autoName('Deals', DEALS, { measure: { fn: 'count' }, groupBy: { attributeId: 'stage' }, chart: 'bar' }),
    ).toBe('Deals by stage');
    expect(autoName('Deals', DEALS, PIPELINE)).toBe('Value by stage');
    expect(
      autoName('Deals', DEALS, {
        measure: { fn: 'count' },
        groupBy: { attributeId: 'created', bucket: 'month' },
        chart: 'line',
      }),
    ).toBe('Deals by month');
    expect(
      autoName('Deals', DEALS, {
        measure: { fn: 'count' },
        groupBy: { attributeId: 'closes', bucket: 'week' },
        chart: 'line',
      }),
    ).toBe('Deals by close date, week');
    expect(autoName('Deals', DEALS, { measure: { fn: 'count' }, chart: 'number' })).toBe('Deals');
  });

  it('tells a changed report from the same one however its keys are ordered', () => {
    const saved = { objectId: 'deals', name: 'Pipeline', config: PIPELINE };
    expect(
      sameReport(saved, {
        ...saved,
        config: { chart: 'bar', groupBy: { attributeId: 'stage' }, measure: PIPELINE.measure },
      }),
    ).toBe(true);
    expect(sameReport(saved, { ...saved, name: ' Pipeline ' })).toBe(true);
    expect(sameReport(saved, { ...saved, name: 'Other' })).toBe(false);
    expect(sameReport(saved, { ...saved, config: { ...PIPELINE, weights: { a: 1 } } })).toBe(false);
    expect(sameReport(saved, { ...saved, objectId: 'people' })).toBe(false);
  });

  it('starts a draft on an object with its name', () => {
    expect(draftOn({ id: 'deals', pluralName: 'Deals' }, DEALS).name).toBe('Value by stage');
  });
});
