// A view's columns (spec 0020): the seeded default opens with the object's opening columns until its first column
// change; any other view runs its own; what a change saves; the config a new view starts from; a duplicate's name.
import type { AttributeDefinition, ObjectSummary, View } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { boardLayout, copyName, layoutOf, startingConfig, switchPatch, withColumn } from './edits.ts';
import { viewColumns, viewReadIds } from './layout.ts';

const attribute = (
  apiSlug: string,
  position: number,
  extra: Partial<AttributeDefinition> = {},
): AttributeDefinition => ({
  id: `id-${apiSlug}`,
  objectId: 'people',
  isPrimary: false,
  isArchived: false,
  apiSlug,
  title: apiSlug,
  type: 'text',
  isMulti: false,
  isRequired: false,
  isUnique: false,
  isSystem: false,
  config: {},
  position,
  ...extra,
});

const ATTRIBUTES: readonly AttributeDefinition[] = [
  attribute('created_at', 0, { isSystem: true, type: 'timestamp' }),
  attribute('name', 0, { type: 'personal_name', isPrimary: true }),
  attribute('email_addresses', 1, { type: 'email' }),
  attribute('job_title', 3),
  attribute('description', 4, { type: 'long_text' }),
  attribute('avatar', 6, { type: 'url' }),
  attribute('old', 7, { isArchived: true }),
];

const PEOPLE: ObjectSummary = {
  id: 'people',
  apiSlug: 'people',
  singularName: 'Person',
  pluralName: 'People',
  icon: 'user',
  hue: 'blue',
  standardKey: 'people',
  primaryAttributeId: 'id-name',
  position: 0,
  isStandard: true,
  isArchived: false,
  access: 'write',
};

const view = (config: Partial<View['config']>): View => ({
  id: 'v',
  objectId: 'people',
  name: 'All People',
  kind: 'table',
  visibility: 'workspace',
  position: 0,
  isDefault: true,
  isLocked: false,
  version: 1,
  queryVersion: 1,
  config: { columns: [], showNewAttributes: true, pinnedCount: 1, sorts: [], ...config },
});

describe('viewColumns', () => {
  it('opens a seeded default view with no saved columns on the object’s opening columns, archived ones left out', () => {
    const layout = viewColumns(view({}), PEOPLE, ATTRIBUTES);
    expect(layout.columns.map((column) => column.id)).toContain('id-email_addresses');
    expect(layout.columns.map((column) => column.id)).not.toContain('id-old');
    expect(layout.columns.find((column) => column.id === 'id-description')?.isHidden).toBe(true);
    expect(layout.columns[0]?.id).toBe('id-name');
  });

  it('runs a view’s saved columns, its widths, and hides attributes it doesn’t list when it shows no new ones', () => {
    const layout = viewColumns(
      view({
        showNewAttributes: false,
        columns: [{ attributeId: 'id-job_title', width: 240 }, { attributeId: 'id-name' }, { attributeId: 'id-old' }],
        pinnedCount: 2,
      }),
      PEOPLE,
      ATTRIBUTES,
    );
    expect(layout.columns.slice(0, 2)).toEqual([
      { id: 'id-name', isHidden: false },
      { id: 'id-job_title', isHidden: false, width: 240 },
    ]);
    expect(layout.columns.find((column) => column.id === 'id-email_addresses')?.isHidden).toBe(true);
    expect(layout.pinnedCount).toBe(2);
    expect(viewReadIds(layout, PEOPLE, ATTRIBUTES)).toEqual(['id-name', 'id-job_title', 'id-avatar']);
  });
});

describe('layoutOf and withColumn', () => {
  it('saves every column in order with whole widths, hidden ones marked, the pinned count kept to 1 to 5', () => {
    expect(
      layoutOf(
        [
          { id: 'a', isHidden: false, width: 120.6 },
          { id: 'b', isHidden: true },
        ],
        9,
      ),
    ).toEqual({
      columns: [
        { attributeId: 'a', width: 121 },
        { attributeId: 'b', isHidden: true },
      ],
      pinnedCount: 5,
    });
  });

  it('adds a new attribute at the end, shown, once', () => {
    const layout = {
      columns: [
        { id: 'a', isHidden: false },
        { id: 'b', isHidden: true },
      ],
      pinnedCount: 1,
    };
    expect(withColumn(layout, 'c').columns.map((column) => column.id)).toEqual(['a', 'b', 'c']);
    expect(withColumn(layout, 'b').columns).toEqual([
      { id: 'a', isHidden: false },
      { id: 'b', isHidden: false },
    ]);
    expect(withColumn(layout, 'a')).toBe(layout);
  });
});

describe('startingConfig', () => {
  it('starts from this view’s columns and the query that runs, or afresh with every own attribute shown', () => {
    const from = {
      layout: { columns: [{ id: 'id-name', isHidden: false }], pinnedCount: 1 },
      query: { sorts: [{ attributeId: 'id-name', direction: 'ascending' as const }] },
    };
    expect(startingConfig(from, PEOPLE, ATTRIBUTES)).toEqual({
      columns: [{ attributeId: 'id-name' }],
      showNewAttributes: false,
      pinnedCount: 1,
      sorts: [{ attributeId: 'id-name', direction: 'ascending' }],
    });
    const fresh = startingConfig(undefined, PEOPLE, ATTRIBUTES);
    expect(fresh.columns.map((column) => column.attributeId)).toEqual([
      'id-name',
      'id-email_addresses',
      'id-job_title',
      'id-description',
      'id-avatar',
    ]);
    expect(fresh).toMatchObject({ showNewAttributes: false, pinnedCount: 1, sorts: [] });
  });
});

describe('copyName', () => {
  it('names a duplicate "<Name> copy", then numbers it while taken, ignoring case', () => {
    expect(copyName('Pipeline', [])).toBe('Pipeline copy');
    expect(copyName('Pipeline', ['pipeline COPY', 'Pipeline copy 2'])).toBe('Pipeline copy 3');
    expect(copyName('x'.repeat(100), []).length).toBeLessThanOrEqual(100);
  });
});

describe('the Table and Board switch (spec 0021, AC-492, AC-497)', () => {
  const stage = attribute('stage', 2, { type: 'status' });
  const WITH_STAGE = [...ATTRIBUTES, stage];
  const BOARD = { groupByAttributeId: 'id-stage', cardFields: ['id-job_title'], showEmptyColumns: true };

  it('fills the defaults the first time a view becomes a board, and saves the kind alone with nothing to group', () => {
    expect(switchPatch(view({}), 'board', WITH_STAGE)).toEqual({
      kind: 'board',
      board: {
        groupByAttributeId: 'id-stage',
        cardFields: ['id-email_addresses', 'id-job_title', 'id-description'],
        showEmptyColumns: true,
      },
    });
    expect(switchPatch(view({}), 'board', ATTRIBUTES)).toEqual({ kind: 'board' });
    // A view that was a board keeps its settings: the kind goes alone, both ways.
    expect(switchPatch(view({ board: BOARD }), 'board', WITH_STAGE)).toEqual({ kind: 'board' });
    expect(switchPatch({ ...view({ board: BOARD }), kind: 'board' }, 'table', WITH_STAGE)).toEqual({ kind: 'table' });
    expect(switchPatch(view({}), 'table', WITH_STAGE)).toBeUndefined();
  });

  it('fills the defaults when the stored grouping field was archived since, so the server never refuses the switch', () => {
    const status = attribute('status', 3, { type: 'status' });
    expect(
      switchPatch(view({ board: BOARD }), 'board', [...ATTRIBUTES, { ...stage, isArchived: true }, status]),
    ).toEqual({
      kind: 'board',
      board: expect.objectContaining({ groupByAttributeId: 'id-status' }) as unknown,
    });
  });

  it('saves the columns as they are with the patch, and a tab only layout carries the kind and board shown', () => {
    const shown: View = {
      ...view({ columns: [{ attributeId: 'id-name' }], pinnedCount: 1, board: BOARD }),
      kind: 'board',
    };
    const off = { ...BOARD, showEmptyColumns: false };
    expect(boardLayout(shown, { board: off }, false)).toEqual({
      columns: [{ attributeId: 'id-name' }],
      pinnedCount: 1,
      board: off,
    });
    expect(boardLayout(shown, { kind: 'table' }, true)).toEqual({
      kind: 'table',
      columns: [{ attributeId: 'id-name' }],
      pinnedCount: 1,
      board: BOARD,
    });
    expect(boardLayout(shown, {}, false)).toEqual({ columns: [{ attributeId: 'id-name' }], pinnedCount: 1 });
  });
});
