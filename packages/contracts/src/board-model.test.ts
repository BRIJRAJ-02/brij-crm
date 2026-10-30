import { describe, expect, it } from 'vitest';
import {
  BOARD_GROUPS_PER_CALL,
  boardColumnIds,
  boardConfigProblem,
  boardDefaults,
  columnFilter,
  groupableAttributes,
  groupCondition,
  groupKeyOf,
  groupKindOf,
  groupValueOf,
  isGroupable,
  liveOptionCount,
  type BoardAttribute,
} from './board-model.ts';
import { RecordGroupsInput } from './records.ts';
import { FilterGroup } from './values/filters.ts';

const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const attribute = (n: number, extra: Partial<BoardAttribute> = {}): BoardAttribute => ({
  id: id(n),
  type: 'text',
  isMulti: false,
  isSystem: false,
  isPrimary: false,
  isArchived: false,
  position: n,
  ...extra,
});

const CREATED_AT = attribute(1, { type: 'timestamp', isSystem: true, position: 0 });
const NAME = attribute(2, { isPrimary: true });
const VALUE = attribute(3, { type: 'currency' });
const PRIORITY = attribute(4, { type: 'select' });
const STAGE = attribute(5, { type: 'status' });
const TAGS = attribute(6, { type: 'select', isMulti: true });
const CLOSE = attribute(7, { type: 'date' });
const OWNER = attribute(8, { type: 'actor_reference' });
const DEALS = [CREATED_AT, NAME, VALUE, PRIORITY, STAGE, TAGS, CLOSE, OWNER];

describe('which attributes group a board', () => {
  it('takes a live status or a select holding one value, never a multi select', () => {
    expect(isGroupable(STAGE)).toBe(true);
    expect(isGroupable(PRIORITY)).toBe(true);
    expect(isGroupable(TAGS)).toBe(false);
    expect(isGroupable(VALUE)).toBe(false);
    expect(isGroupable({ ...STAGE, isArchived: true })).toBe(false);
  });

  it('takes a checkbox and a member field holding one person, never Created by nor several people', () => {
    expect(groupKindOf(attribute(11, { type: 'checkbox' }))).toBe('checkbox');
    expect(groupKindOf(OWNER)).toBe('member');
    expect(groupKindOf(STAGE)).toBe('option');
    expect(isGroupable({ ...OWNER, isMulti: true })).toBe(false);
    expect(isGroupable({ ...OWNER, isSystem: true })).toBe(false);
  });

  it('lists status attributes first by position, then single selects, members and checkboxes', () => {
    const second = attribute(9, { type: 'status', position: 1 });
    const done = attribute(10, { type: 'checkbox' });
    expect(groupableAttributes([...DEALS, second, done]).map((each) => each.id)).toEqual([
      second.id,
      STAGE.id,
      PRIORITY.id,
      OWNER.id,
      done.id,
    ]);
  });
});

describe('a board view first defaults (AC-492)', () => {
  it('groups by the first status and shows the first 3 non system, non primary fields other than it', () => {
    expect(boardDefaults(DEALS)).toEqual({
      groupByAttributeId: STAGE.id,
      cardFields: [VALUE.id, PRIORITY.id, TAGS.id],
      showEmptyColumns: true,
    });
  });

  it('falls back to the first single select, and skips archived fields', () => {
    const withoutStatus = DEALS.filter((each) => each !== STAGE).map((each) =>
      each === VALUE ? { ...each, isArchived: true } : each,
    );
    expect(boardDefaults(withoutStatus)).toEqual({
      groupByAttributeId: PRIORITY.id,
      cardFields: [TAGS.id, CLOSE.id, OWNER.id],
      showEmptyColumns: true,
    });
  });

  it('is undefined when nothing can group (AC-493)', () => {
    expect(boardDefaults([CREATED_AT, NAME, VALUE, TAGS])).toBeUndefined();
  });
});

describe('a stored board config', () => {
  const good = { groupByAttributeId: STAGE.id, cardFields: [VALUE.id], showEmptyColumns: true };

  it('passes when it groups by a status and lists the object own fields', () => {
    expect(boardConfigProblem(good, DEALS)).toBeUndefined();
  });

  it('refuses a grouping that is not a live status or single select', () => {
    for (const groupBy of [TAGS.id, VALUE.id, id(99)]) {
      expect(boardConfigProblem({ ...good, groupByAttributeId: groupBy }, DEALS)).toBe(
        'Boards group by a status, a single select, a checkbox or a member field.',
      );
    }
  });

  it('refuses a 7th field, a field twice, another object field and the name', () => {
    const seven = [VALUE, PRIORITY, TAGS, CLOSE, OWNER, CREATED_AT, attribute(10)].map((each) => each.id);
    expect(boardConfigProblem({ ...good, cardFields: seven }, [...DEALS, attribute(10)])).toMatch(/at most 6/);
    expect(boardConfigProblem({ ...good, cardFields: [VALUE.id, VALUE.id] }, DEALS)).toMatch(/once/);
    expect(boardConfigProblem({ ...good, cardFields: [id(99)] }, DEALS)).toMatch(/not a field/);
    expect(boardConfigProblem({ ...good, cardFields: [NAME.id] }, DEALS)).toMatch(/name always shows/);
  });
});

describe('a column filter', () => {
  it('is the option, or empty for the no value column', () => {
    expect(groupCondition(STAGE.id, id(50))).toEqual({ attributeId: STAGE.id, operator: 'is', value: id(50) });
    expect(groupCondition(STAGE.id, null)).toEqual({ attributeId: STAGE.id, operator: 'is_empty' });
  });

  it('joins the view filter and the column condition, and parses as a filter', () => {
    const view: FilterGroup = {
      conjunction: 'or',
      conditions: [{ attributeId: VALUE.id, operator: 'is_empty' }],
    };
    const joined = columnFilter(view, STAGE.id, id(50));
    expect(joined).toEqual({ conjunction: 'and', conditions: [view, groupCondition(STAGE.id, id(50))] });
    expect(FilterGroup.safeParse(joined).success).toBe(true);
    expect(columnFilter(undefined, STAGE.id, null)).toEqual({
      conjunction: 'and',
      conditions: [groupCondition(STAGE.id, null)],
    });
    expect(columnFilter({ conjunction: 'and', conditions: [] }, STAGE.id, null).conditions).toHaveLength(1);
  });
});

describe('a checkbox or member column', () => {
  it('filters by the checked state, and a member by id', () => {
    expect(groupCondition(id(11), 'checked', 'checkbox')).toEqual({ attributeId: id(11), operator: 'is_checked' });
    expect(groupCondition(id(11), 'unchecked', 'checkbox')).toEqual({
      attributeId: id(11),
      operator: 'is_not_checked',
    });
    expect(groupCondition(OWNER.id, id(60), 'member')).toEqual({
      attributeId: OWNER.id,
      operator: 'is',
      value: id(60),
    });
    expect(FilterGroup.safeParse(columnFilter(undefined, id(11), 'checked', 'checkbox')).success).toBe(true);
  });

  it('maps a value to its column and a column back to the value a move writes', () => {
    expect(groupKeyOf('checkbox', true)).toBe('checked');
    expect(groupKeyOf('checkbox', null)).toBe('unchecked');
    expect(groupKeyOf('member', { type: 'member', id: id(60) })).toBe(id(60));
    expect(groupKeyOf('member', { type: 'system', id: null })).toBeNull();
    expect(groupKeyOf('option', id(50))).toBe(id(50));
    expect(groupValueOf('checkbox', 'unchecked')).toBe(false);
    expect(groupValueOf('member', id(60))).toEqual({ type: 'member', id: id(60) });
    expect(groupValueOf('member', null)).toBeNull();
  });

  it('parses checked and unchecked as column ids in records.groups', () => {
    const input = { workspace: 'acme', objectId: id(1), groupBy: id(11), groupIds: ['unchecked', 'checked'] };
    expect(RecordGroupsInput.safeParse(input).success).toBe(true);
    expect(RecordGroupsInput.safeParse({ ...input, groupIds: ['maybe'] }).success).toBe(false);
  });
});

describe('columns', () => {
  it('puts the no value column first, then options by position, and counts the live ones', () => {
    const options = [
      { id: 'b', position: 2, isArchived: false },
      { id: 'a', position: 1, isArchived: true },
      { id: 'c', position: 0, isArchived: false },
    ];
    expect(boardColumnIds(options)).toEqual([null, 'c', 'a', 'b']);
    expect(liveOptionCount(options)).toBe(2);
  });
});

describe('records.groups input', () => {
  const base = { workspace: 'acme', objectId: id(1), groupBy: STAGE.id };

  it('takes 1 to 12 distinct columns, null for no value', () => {
    expect(RecordGroupsInput.safeParse({ ...base, groupIds: [null, id(50)] }).success).toBe(true);
    expect(RecordGroupsInput.safeParse({ ...base, groupIds: [] }).success).toBe(false);
    expect(RecordGroupsInput.safeParse({ ...base, groupIds: [id(50), id(50)] }).success).toBe(false);
    const thirteen = Array.from({ length: BOARD_GROUPS_PER_CALL + 1 }, (_, n) => id(100 + n));
    expect(RecordGroupsInput.safeParse({ ...base, groupIds: thirteen }).success).toBe(false);
  });

  it('caps a column page at 50', () => {
    expect(RecordGroupsInput.safeParse({ ...base, groupIds: [null], limit: 50 }).success).toBe(true);
    expect(RecordGroupsInput.safeParse({ ...base, groupIds: [null], limit: 51 }).success).toBe(false);
  });
});
