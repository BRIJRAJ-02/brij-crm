import type { AttributeDefinition } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { applyLabels, cellGroups, labelKey, rowPlan, type LabelChoice } from './review.ts';

type SelectLike = Pick<AttributeDefinition, 'type' | 'isMulti' | 'options'>;
const options: AttributeDefinition['options'] = [
  { id: 'o-gold', label: 'Gold', hue: 'yellow', isArchived: false, position: 0 },
  { id: 'o-silver', label: 'Silver', hue: 'gray', isArchived: false, position: 1 },
];
const single: SelectLike = { type: 'select', isMulti: false, options };
const multi: SelectLike = { type: 'select', isMulti: true, options };
const choices = (entries: readonly (readonly [string, LabelChoice])[]) =>
  new Map(entries.map(([label, choice]) => [labelKey(label), choice]));

describe('applyLabels', () => {
  it('maps a label to an option, leaves one empty, and keeps one to create', () => {
    const decided = choices([
      ['Golden', { kind: 'map', optionId: 'o-gold' }],
      ['Unknown', { kind: 'empty' }],
      ['Bronze', { kind: 'create' }],
    ]);
    expect(applyLabels('golden', single, decided)).toBe('Gold');
    expect(applyLabels('Unknown', single, decided)).toBe('');
    expect(applyLabels('Bronze', single, decided)).toBe('Bronze');
    expect(applyLabels('Silver', single, decided)).toBe('Silver');
  });

  it('keeps a list cell’s other labels', () => {
    const decided = choices([
      ['Golden', { kind: 'map', optionId: 'o-gold' }],
      ['Unknown', { kind: 'empty' }],
    ]);
    expect(applyLabels('Golden; Unknown, Silver', multi, decided)).toBe('Gold, Silver');
  });

  it('leaves the cell as written with no choices', () => {
    expect(applyLabels(' Golden ', single, undefined)).toBe(' Golden ');
  });
});

describe('cellGroups', () => {
  const problem = (column: number, header: string) => ({ column, header, reason: `${header} won’t read.` });
  it('groups unreadable cells by column, counts them and keeps the first few', () => {
    const groups = cellGroups(
      [
        { rowNumber: 2, cells: ['x', 'bad', 'q'], problems: [problem(1, 'Email')] },
        { rowNumber: 3, cells: ['y', 'worse', 'r'], problems: [problem(1, 'Email'), problem(2, 'Tier')] },
        { rowNumber: 4, cells: ['', '', ''], problems: [{ column: -1, header: '', reason: 'Empty.' }] },
      ],
      new Set([2]),
    );
    expect(groups).toEqual([
      { column: 1, header: 'Email', count: 2, samples: ['bad', 'worse'], reason: 'Email won’t read.' },
    ]);
  });
});

describe('rowPlan', () => {
  const rows = [{ rowNumber: 2 }, { rowNumber: 3 }, { rowNumber: 4 }, { rowNumber: 5 }];
  const answers = [
    { keys: ['ada@x.com'], matched: true },
    { keys: ['bob@x.com'], matched: false },
    // The same email as the row before: the record that row makes, so an update, never a second record.
    { keys: ['bob@x.com'], matched: false },
    { keys: [], matched: false },
  ];

  it('counts new, update and skip as the job will', () => {
    expect(rowPlan(rows, answers, 'fill', 'create')).toEqual({ created: 2, updated: 2, skipped: 0 });
    expect(rowPlan(rows, answers, 'skip', 'create')).toEqual({ created: 2, updated: 0, skipped: 2 });
    expect(rowPlan(rows, answers, 'fill', 'skip')).toEqual({ created: 0, updated: 1, skipped: 3 });
  });

  it('counts every row new with no lookup (no match attribute)', () => {
    expect(rowPlan(rows, undefined, 'fill', 'create')).toEqual({ created: 4, updated: 0, skipped: 0 });
  });
});
