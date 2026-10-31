import type { ReportFigures, ReportPoint } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { chartPointsOf, formatsFor, namesOf } from './format.ts';

const context = { locale: 'en-GB', groupTitle: 'Stage' };

describe('formatsFor', () => {
  it('writes a count with separators, and a capped one with a plus', () => {
    const formats = formatsFor('en-GB', 'count', undefined);
    expect(formats.value(1234)).toBe('1,234');
    expect(formats.value(10_000, true)).toBe('10,000+');
    expect(formats.tick(12_000)).toBe('12k');
  });

  it('writes money whole when it is, and with pence when it is not', () => {
    const formats = formatsFor('en-GB', 'amount', 'USD');
    expect(formats.value(12_400)).toBe('US$12,400');
    expect(formats.value(12.5)).toBe('US$12.50');
    expect(formats.tick(12_400)).toBe('US$12.4k');
  });

  it('writes plain numbers with at most two decimals', () => {
    const formats = formatsFor('en-GB', 'amount', undefined);
    expect(formats.value(4.256)).toBe('4.26');
    expect(formats.value(4)).toBe('4');
  });
});

describe('namesOf', () => {
  const point = (over: Partial<ReportPoint>): ReportPoint => ({ value: 0, atLeast: false, ...over });

  it('names an option or member as it is, and the empty group "No stage"', () => {
    expect(namesOf(point({ id: 'a', label: 'Lead' }), undefined, context)).toEqual({ label: 'Lead' });
    expect(namesOf(point({ id: null }), undefined, context)).toEqual({ label: 'No stage' });
  });

  it("words a checkbox's columns", () => {
    expect(namesOf(point({ id: 'checked' }), undefined, context).label).toBe('Checked');
    expect(namesOf(point({ id: 'unchecked' }), undefined, context).label).toBe('Not checked');
  });

  it('names a period by its month or week, with a short name for the axis', () => {
    expect(namesOf(point({ start: '2026-10-01' }), 'month', context)).toEqual({
      label: 'October 2026',
      axisLabel: 'Oct',
    });
    expect(namesOf(point({ start: '2026-10-26' }), 'week', context)).toEqual({
      label: '26 Oct 2026',
      axisLabel: '26 Oct',
    });
  });
});

describe('chartPointsOf', () => {
  const figures: ReportFigures = {
    points: [
      { id: 'a', label: 'Lead', value: 1200, atLeast: false },
      { id: null, value: 0, atLeast: false },
    ],
    unit: 'amount',
    currency: 'USD',
    otherCurrencies: [],
    tooMany: false,
    truncated: false,
    hasData: true,
    total: 1200,
    isAverage: false,
  };

  it('words each point and gives it an id of its own', () => {
    const points = chartPointsOf(figures, undefined, context, formatsFor('en-GB', 'amount', 'USD'));
    expect(points).toEqual([
      { id: 'a', label: 'Lead', value: 1200, valueText: 'US$1,200' },
      { id: 'none', label: 'No stage', value: 0, valueText: 'US$0' },
    ]);
  });

  it('keys a period by its first day', () => {
    const periods: ReportFigures = {
      ...figures,
      points: [{ start: '2026-10-01', value: 3, atLeast: false }],
      unit: 'count',
      currency: undefined,
    };
    const [only] = chartPointsOf(periods, 'month', context, formatsFor('en-GB', 'count', undefined));
    expect(only).toMatchObject({ id: '2026-10-01', label: 'October 2026', axisLabel: 'Oct', valueText: '3' });
  });
});
