import type { AttributeDefinition } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { planBoard } from './plan.ts';

const attribute = (id: string, extra: Partial<AttributeDefinition> = {}): AttributeDefinition => ({
  id,
  objectId: 'deals',
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

const option = (id: string, position: number, isArchived = false) => ({
  id,
  label: id,
  hue: 'blue' as const,
  position,
  isArchived,
});

const CREATED = attribute('created', { isSystem: true, apiSlug: 'created_at', type: 'timestamp', position: 0 });
const NAME = attribute('name', { isPrimary: true, position: 1 });
const VALUE = attribute('value', { type: 'currency', position: 2 });
const STAGE = attribute('stage', {
  type: 'status',
  position: 3,
  options: [option('won', 2), option('lead', 0), option('old', 1, true)],
});
const PRIORITY = attribute('priority', { type: 'select', position: 4, options: [option('low', 0)] });
const OWNER = attribute('owner', { type: 'actor_reference', position: 6 });
const DEALS = [CREATED, NAME, VALUE, STAGE, PRIORITY, OWNER];

describe('the board a view shows', () => {
  it('groups by the first status by default, the no value column first, then options by position', () => {
    const plan = planBoard(DEALS, undefined);
    if (plan.kind !== 'board') throw new Error('A board.');
    expect(plan.groupBy.id).toBe('stage');
    expect(plan.isStored).toBe(false);
    expect(plan.columnIds).toEqual([null, 'lead', 'old', 'won']);
    expect(plan.archivedIds).toEqual(['old']);
    expect(plan.cardFields.map((field) => field.id)).toEqual(['value', 'priority', 'owner']);
    expect(plan.settings.showEmptyColumns).toBe(true);
  });

  it('says when another field stands in for a grouping field the reader can’t use (late trap #29)', () => {
    // Hidden from this reader: absent from their attributes, so the first status stands in, and says so.
    const hidden = planBoard(DEALS, { groupByAttributeId: 'secret', cardFields: [], showEmptyColumns: true });
    if (hidden.kind !== 'board') throw new Error('A board.');
    expect(hidden.groupBy.id).toBe('stage');
    expect(hidden.isStandIn).toBe(true);
    // A board with nothing stored uses the defaults without anything to say.
    const fresh = planBoard(DEALS, undefined);
    if (fresh.kind !== 'board') throw new Error('A board.');
    expect(fresh.isStandIn).toBe(false);
  });

  it('keeps the stored settings, leaving out archived card fields and the name', () => {
    const plan = planBoard([...DEALS, attribute('gone', { isArchived: true })], {
      groupByAttributeId: 'priority',
      cardFields: ['owner', 'gone', 'name'],
      showEmptyColumns: false,
    });
    if (plan.kind !== 'board') throw new Error('A board.');
    expect(plan.isStored).toBe(true);
    expect(plan.groupBy.id).toBe('priority');
    expect(plan.cardFields.map((field) => field.id)).toEqual(['owner']);
    expect(plan.settings.showEmptyColumns).toBe(false);
  });

  it('says when nothing can group, when the grouping field was archived, and past 50 options', () => {
    expect(planBoard([CREATED, NAME, VALUE], undefined)).toEqual({ kind: 'nothing-to-group' });
    expect(
      planBoard([...DEALS.filter((each) => each !== STAGE), { ...STAGE, isArchived: true }], {
        groupByAttributeId: 'stage',
        cardFields: [],
        showEmptyColumns: true,
      }),
    ).toEqual({ kind: 'group-archived', title: 'stage' });
    const crowded = attribute('crowd', {
      type: 'status',
      position: 0,
      options: Array.from({ length: 51 }, (_, n) => option(`o${String(n)}`, n)),
    });
    expect(planBoard([crowded], undefined)).toEqual({ kind: 'too-many', title: 'crowd', count: 51 });
  });

  it('falls back to the defaults when the stored grouping field is no longer groupable', () => {
    const plan = planBoard(DEALS, { groupByAttributeId: 'value', cardFields: [], showEmptyColumns: true });
    expect(plan.kind === 'board' && plan.groupBy.id).toBe('stage');
  });
});
