// The fixed view shapes and the columns a window reads (spec 0011, AC-198):
// the plain views jump by position, every filtered one pages by cursor by
// spec 0006's one rule, and a window names the columns on screen plus what
// an edit, a filter or a sort needs.
import { describe, expect, it } from 'vitest';
import {
  columnsOnScreen,
  EDITABLE,
  jumpsByPosition,
  SCREEN_COLUMNS,
  viewShapes,
  type ShapeAttribute,
} from './shapes.ts';

let next = 0;
const attribute = (apiSlug: string, type: string, extra: Partial<ShapeAttribute> = {}) => {
  next += 1;
  return {
    id: `00000000-0000-7000-8000-${String(next).padStart(12, '0')}`,
    apiSlug,
    type,
    isSystem: false,
    isMulti: false,
    options: ['option-a', 'option-b', 'option-c'],
    position: next,
    ...extra,
  };
};

const people = [
  attribute('name', 'personal_name'),
  attribute('email_addresses', 'email', { isMulti: true }),
  attribute('job_title', 'text'),
  attribute('owner', 'actor_reference'),
  attribute('created_at', 'timestamp', { isSystem: true }),
  attribute('email_opt_out', 'checkbox'),
  ...Array.from({ length: 12 }, (_, index) => attribute(`extra_${String(index)}`, 'text')),
  attribute('description', 'long_text'),
];
const deals = [
  attribute('name', 'text'),
  attribute('stage', 'status'),
  attribute('owner', 'actor_reference'),
  attribute('value', 'currency', { currency: 'USD' }),
  attribute('close_date', 'date'),
  attribute('next_step', 'text'),
];
const byslug = (list: readonly ReturnType<typeof attribute>[]) => new Map(list.map((each) => [each.apiSlug, each]));

describe('viewShapes', () => {
  it('gives each object a plain view and a name sort by position, and its filtered shapes by cursor', () => {
    const attributes = byslug(people);
    const shapes = viewShapes('people', { attributes, memberIds: ['member-1'] });
    expect(shapes.map((shape) => [shape.name, jumpsByPosition(shape, attributes)])).toEqual([
      ['all', true],
      ['by name', true],
      ['job title contains manager, by name', false],
      ['owner is a member, by created', false],
      ['email opt out', false],
    ]);
    const dealShapes = viewShapes('deals', { attributes: byslug(deals), memberIds: ['member-1'] });
    expect(dealShapes.filter((shape) => !jumpsByPosition(shape, byslug(deals)))).toHaveLength(4);
    const value = dealShapes.find((shape) => shape.name.startsWith('value'));
    expect(value?.filter?.conditions[0]).toMatchObject({
      operator: 'gt',
      value: { amount: '100000', currency: 'USD' },
    });
  });
});

describe('columnsOnScreen', () => {
  it('reads the first columns by position, then what edits, filters and sorts need, each once', () => {
    const attributes = byslug(people);
    const shapes = viewShapes('people', { attributes, memberIds: ['member-1'] });
    const columns = columnsOnScreen('people', people, shapes);
    const slugOf = new Map(people.map((each) => [each.id, each.apiSlug]));
    const slugs = columns.map((id) => slugOf.get(id));
    expect(slugs.slice(0, SCREEN_COLUMNS)).toEqual(
      people
        .filter((each) => !each.isSystem)
        .slice(0, SCREEN_COLUMNS)
        .map((each) => each.apiSlug),
    );
    for (const slug of [...EDITABLE.people, 'owner', 'created_at']) expect(slugs).toContain(slug);
    expect(new Set(columns).size).toBe(columns.length);
    expect(columns.length).toBeLessThan(people.length);
  });
});
