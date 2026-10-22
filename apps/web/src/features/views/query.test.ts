import type { AttributeDefinition, View } from '@crm/data';
import { describe, expect, it } from 'vitest';
import {
  createView,
  isDefaultSort,
  landingView,
  relationTarget,
  runningQuery,
  savableQuery,
  savedQuery,
  toViewQuery,
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
