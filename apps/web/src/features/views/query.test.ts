import type { AttributeDefinition, View } from '@crm/data';
import { describe, expect, it } from 'vitest';
import {
  createView,
  farAttributesUnchecked,
  throughTargets,
  isDefaultSort,
  withDefaultOrderAsNone,
  landingView,
  relationTarget,
  runningQuery,
  savableQuery,
  savedQuery,
  toViewQuery,
  VIEW_SORTS_MAX,
  withHeaderSort,
  withSearch,
} from './query.ts';

const attribute = (id: string, extra: Partial<AttributeDefinition> = {}): AttributeDefinition => ({
  id,
  objectId: 'people',
  apiSlug: id,
  title: id,
  type: 'text',
  isMulti: false,
  isRequired: false,
  isUnique: false,
  isSystem: false,
  isPrimary: false,
  config: {},
  position: 5,
  isArchived: false,
  ...extra,
});

const CREATED = attribute('created', { isSystem: true, apiSlug: 'created_at', type: 'timestamp', position: 1 });
const NAME = attribute('name');
const COMPANY = attribute('company', { type: 'record_reference' });
const ATTRIBUTES = [CREATED, NAME, COMPANY];

describe('what a view runs', () => {
  it('runs a view with no sorts newest first, and saves no sorts for it', () => {
    const effective = runningQuery({ sorts: [] }, ATTRIBUTES);
    if (effective.status !== 'ready') throw new Error('ready');
    expect(toViewQuery(effective)).toEqual({ sorts: [{ attributeId: 'created', direction: 'descending' }] });
    expect(savableQuery({ sorts: [] }, effective)).toEqual({ sorts: [] });
  });

  it('saves only what runs: a sort on a gone attribute goes', () => {
    const query = {
      sorts: [
        { attributeId: 'gone', direction: 'ascending' as const },
        { attributeId: 'name', direction: 'descending' as const },
      ],
    };
    const effective = runningQuery(query, ATTRIBUTES);
    if (effective.status !== 'ready') throw new Error('ready');
    expect(savableQuery(query, effective)).toEqual({ sorts: [{ attributeId: 'name', direction: 'descending' }] });
  });

  it('keeps a through condition for the server while a reference doesn’t say where it leads', () => {
    const filter = {
      conjunction: 'and' as const,
      conditions: [
        {
          operator: 'through' as const,
          path: ['company'],
          condition: { attributeId: 'industry', operator: 'is_not_empty' as const },
        },
      ],
    };
    expect(relationTarget(COMPANY)).toBeUndefined();
    expect(runningQuery({ filter, sorts: [] }, ATTRIBUTES)).toMatchObject({ status: 'ready', filter });
    const linked = { ...COMPANY, relationship: { targetObjectIds: ['companies'] } } as AttributeDefinition;
    expect(relationTarget(linked)).toBe('companies');
    expect(runningQuery({ filter, sorts: [] }, [CREATED, NAME, linked])).toEqual({ status: 'pending' });
    // Asked before the far attributes load (the page's first rows, late trap #45): kept for the server to check,
    // never dropped to an unfiltered table.
    const withLinked = [CREATED, NAME, linked];
    expect(runningQuery({ filter, sorts: [] }, withLinked, farAttributesUnchecked(withLinked))).toMatchObject({
      status: 'ready',
      filter,
    });
    // The page reads the far object first; a far field the reader can't use then drops out before anything runs.
    expect(throughTargets({ filter, sorts: [] }, withLinked)).toEqual(['companies']);
    const read = farAttributesUnchecked(withLinked, (id) => (id === 'companies' ? [] : undefined));
    expect(runningQuery({ filter, sorts: [] }, withLinked, read)).toMatchObject({ status: 'ready' });
    expect(runningQuery({ filter, sorts: [] }, withLinked, read)).not.toHaveProperty('filter');
  });

  it('reads a view’s saved query', () => {
    const view = {
      config: { columns: [], showNewAttributes: true, pinnedCount: 1, sorts: [] },
    } as unknown as View;
    expect(savedQuery(view)).toEqual({ sorts: [] });
  });
});

describe('landingView (AC-462)', () => {
  const views = [{ id: 'a' }, { id: 'b' }];
  it('opens the last view opened, else the default, else the first', () => {
    expect(landingView({ views, defaultViewId: 'b', lastOpenedViewId: 'a' })).toBe('a');
    expect(landingView({ views, defaultViewId: 'b', lastOpenedViewId: 'gone' })).toBe('b');
    expect(landingView({ views, defaultViewId: 'gone' })).toBe('a');
    expect(landingView({ views: [] })).toBeUndefined();
  });
});

describe('createView (spec 0039, AC-1086)', () => {
  const views = [
    { id: 'board', kind: 'board' },
    { id: 'a', kind: 'table' },
    { id: 'b', kind: 'table' },
  ];
  it('opens the landing view when a table, else the default table, else the first table, else none', () => {
    expect(createView({ views, lastOpenedViewId: 'b', defaultViewId: 'a' })).toBe('b');
    expect(createView({ views, lastOpenedViewId: 'board', defaultViewId: 'b' })).toBe('b');
    expect(createView({ views, lastOpenedViewId: 'board', defaultViewId: 'board' })).toBe('a');
    expect(createView({ views: [{ id: 'board', kind: 'board' }] })).toBeUndefined();
  });
});

describe('withSearch', () => {
  const sorts = [{ attributeId: 'name', direction: 'ascending' as const }];
  const contains = { attributeId: 'name', operator: 'contains', value: 'ada' };

  it('leaves the query alone with nothing typed or nothing to search', () => {
    const query = { sorts };
    expect(withSearch(query, 'name', '  ')).toBe(query);
    expect(withSearch(query, undefined, 'ada')).toBe(query);
  });

  it('is the whole filter on an unfiltered view, trimmed', () => {
    expect(withSearch({ sorts }, 'name', ' ada ')).toEqual({
      sorts,
      filter: { conjunction: 'and', conditions: [contains] },
    });
  });

  it('joins an and filter, and wraps an or filter', () => {
    const owner = { attributeId: 'owner', operator: 'is_me' as const };
    expect(withSearch({ sorts, filter: { conjunction: 'and', conditions: [owner] } }, 'name', 'ada').filter).toEqual({
      conjunction: 'and',
      conditions: [owner, contains],
    });
    const either = { conjunction: 'or' as const, conditions: [owner, owner] };
    expect(withSearch({ sorts, filter: either }, 'name', 'ada').filter).toEqual({
      conjunction: 'and',
      conditions: [either, contains],
    });
  });
});

describe('withHeaderSort', () => {
  const up = (attributeId: string) => ({ attributeId, direction: 'ascending' as const });
  const down = (attributeId: string) => ({ attributeId, direction: 'descending' as const });

  it('puts a new column first and keeps the other sorts after it', () => {
    expect(withHeaderSort([up('name'), down('company')], up('stage'), ATTRIBUTES)).toEqual([
      up('stage'),
      up('name'),
      down('company'),
    ]);
  });

  it('replaces the column’s own rule, moving it first in the direction asked', () => {
    expect(withHeaderSort([up('name'), up('company')], down('company'), ATTRIBUTES)).toEqual([
      down('company'),
      up('name'),
    ]);
  });

  it('never keeps the default order as a rule of its own', () => {
    expect(withHeaderSort([down('created')], up('name'), ATTRIBUTES)).toEqual([up('name')]);
    expect(withHeaderSort([], up('name'), ATTRIBUTES)).toEqual([up('name')]);
  });

  it('keeps at most the view’s limit, dropping the last', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map(up);
    const next = withHeaderSort(many, up('f'), ATTRIBUTES);
    expect(next).toHaveLength(VIEW_SORTS_MAX);
    expect(next[0]).toEqual(up('f'));
    expect(next.at(-1)).toEqual(up('d'));
  });
});

describe('isDefaultSort', () => {
  const NAME = attribute('name');
  it('is the default with no sorts, or with exactly Created at newest first', () => {
    expect(isDefaultSort([], [CREATED, NAME])).toBe(true);
    expect(isDefaultSort([{ attributeId: 'created', direction: 'descending' }], [CREATED, NAME])).toBe(true);
  });

  it('is not the default for another order, another attribute, or more than one sort', () => {
    expect(isDefaultSort([{ attributeId: 'created', direction: 'ascending' }], [CREATED, NAME])).toBe(false);
    expect(isDefaultSort([{ attributeId: 'name', direction: 'descending' }], [CREATED, NAME])).toBe(false);
    expect(
      isDefaultSort(
        [
          { attributeId: 'created', direction: 'descending' },
          { attributeId: 'name', direction: 'ascending' },
        ],
        [CREATED, NAME],
      ),
    ).toBe(false);
  });
});

describe('withDefaultOrderAsNone', () => {
  it('writes the default order as no sorts, so the two forms compare the same', () => {
    expect(withDefaultOrderAsNone({ sorts: [{ attributeId: 'created', direction: 'descending' }] }, [CREATED])).toEqual(
      {
        sorts: [],
      },
    );
    expect(withDefaultOrderAsNone({ sorts: [] }, [CREATED])).toEqual({ sorts: [] });
  });

  it('leaves any other order as it is', () => {
    const query = { sorts: [{ attributeId: 'created', direction: 'ascending' as const }] };
    expect(withDefaultOrderAsNone(query, [CREATED])).toBe(query);
  });
});
