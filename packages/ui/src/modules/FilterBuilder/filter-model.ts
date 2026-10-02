// The filter builder's pure core (spec 0003, filter conditions): new
// conditions, what each operator's operand starts as, whether a condition can
// filter yet, and edits to a group by an index path. Pure, so every rule is
// tested without a browser.
import {
  MAX_FILTER_DEPTH,
  type FilterCondition,
  type FilterGroup,
  type FilterOperator,
  type RelativeRange,
} from '@crm/contracts/values';
import { fieldTypeOf } from '../../fields/registry.ts';
import type { FieldAttribute, OperandKind, OperatorDef } from '../../fields/types.ts';

/** One row of a group: a condition, or a group of its own. */
export type FilterItem = FilterCondition | FilterGroup;

/** A condition on one attribute, not through a relation. */
export type LeafCondition = Exclude<FilterCondition, { readonly operator: 'through' }>;

/** Where an item sits: its index in each group from the top down. */
export type ItemPath = readonly number[];

/** True for a group, false for a condition. */
export function isGroup(item: FilterItem): item is FilterGroup {
  return 'conjunction' in item;
}

/** A condition's relations and the condition at their end: Company › Country is `{ path: ['company'], leaf }`. */
export function leafOf(condition: FilterCondition): { readonly path: readonly string[]; readonly leaf: LeafCondition } {
  if (condition.operator !== 'through') return { path: [], leaf: condition };
  const inner = leafOf(condition.condition);
  return { path: [...condition.path, ...inner.path], leaf: inner.leaf };
}

/** The leaf at the end of `path`'s relations. */
export function throughPath(path: readonly string[], leaf: LeafCondition): FilterCondition {
  return path.length === 0 ? leaf : { operator: 'through', path, condition: leaf };
}

/** The operators an attribute offers in the builder; relations are followed from the attribute picker. */
export function operatorsFor(attribute: FieldAttribute): readonly OperatorDef[] {
  return fieldTypeOf(attribute.type)
    .operators(attribute)
    .filter((each) => each.operand !== 'through');
}

/** How `operator` takes its operand on `attribute`. */
export function operandOf(attribute: FieldAttribute, operator: FilterOperator): OperandKind {
  return operatorsFor(attribute).find((each) => each.operator === operator)?.operand ?? 'value';
}

/** Where a relative range starts: this week for "within", the last 7 days for "within the last". */
const DEFAULT_RANGE: { readonly within: RelativeRange; readonly within_last: RelativeRange } = {
  within: 'this_week',
  within_last: { amount: 7, unit: 'day' },
};

/** A condition on `attribute` with `operator` (its type's first, by default) and no operand yet. */
export function conditionOn(attribute: FieldAttribute, operator?: FilterOperator): LeafCondition {
  const chosen = operator ?? operatorsFor(attribute)[0]?.operator ?? 'is_empty';
  const attributeId = attribute.id;
  switch (operandOf(attribute, chosen)) {
    case 'range':
      return { attributeId, operator: 'between', from: undefined, to: undefined };
    case 'list':
      return { attributeId, operator: chosen as Extract<LeafCondition, { values: unknown }>['operator'], values: [] };
    case 'relative': {
      const relative = chosen === 'within' ? 'within' : 'within_last';
      return { attributeId, operator: relative, range: DEFAULT_RANGE[relative] };
    }
    case 'none':
      return {
        attributeId,
        operator: chosen as Exclude<LeafCondition, { value: unknown }>['operator'],
      } as LeafCondition;
    default:
      return {
        attributeId,
        operator: chosen as Extract<LeafCondition, { value: unknown }>['operator'],
        value: undefined,
      };
  }
}

const isSet = (value: unknown) =>
  value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0);

/** Whether a condition has all it needs to filter. One without its operand filters nothing until it has one. */
export function isComplete(condition: FilterCondition): boolean {
  if (condition.operator === 'through') return isComplete(condition.condition);
  if ('value' in condition) return isSet(condition.value);
  if ('values' in condition) return condition.values.length > 0;
  if ('from' in condition) return isSet(condition.from) && isSet(condition.to);
  return true;
}

/** The group without its incomplete conditions or the groups they leave empty: what a view saves and runs. */
export function completeFilters(group: FilterGroup): FilterGroup {
  const conditions = group.conditions.flatMap((item): FilterItem[] => {
    if (!isGroup(item)) return isComplete(item) ? [item] : [];
    const inner = completeFilters(item);
    return inner.conditions.length === 0 ? [] : [inner];
  });
  return { conjunction: group.conjunction, conditions };
}

/** How many complete conditions the group holds, at every depth: the count a Filter chip shows. */
export function countFilters(group: FilterGroup): number {
  return group.conditions.reduce(
    (total, item) => total + (isGroup(item) ? countFilters(item) : isComplete(item) ? 1 : 0),
    0,
  );
}

/** The group at `path`, or undefined when the path doesn't lead to one. */
export function groupAt(group: FilterGroup, path: ItemPath): FilterGroup | undefined {
  const [first, ...rest] = path;
  if (first === undefined) return group;
  const item = group.conditions[first];
  return item !== undefined && isGroup(item) ? groupAt(item, rest) : undefined;
}

/** The group with the item at `path` replaced by what `update` makes of it. */
export function updateItem(group: FilterGroup, path: ItemPath, update: (item: FilterItem) => FilterItem): FilterGroup {
  const [first, ...rest] = path;
  if (first === undefined) return group;
  return {
    ...group,
    conditions: group.conditions.map((item, index) => {
      if (index !== first) return item;
      if (rest.length === 0) return update(item);
      return isGroup(item) ? updateItem(item, rest, update) : item;
    }),
  };
}

/** The group without the item at `path`. A nested group left empty goes too. */
export function removeItem(group: FilterGroup, path: ItemPath): FilterGroup {
  const [first, ...rest] = path;
  if (first === undefined) return group;
  const conditions = group.conditions.flatMap((item, index): FilterItem[] => {
    if (index !== first) return [item];
    if (rest.length === 0 || !isGroup(item)) return [];
    const inner = removeItem(item, rest);
    return inner.conditions.length === 0 ? [] : [inner];
  });
  return { ...group, conditions };
}

/** The group with `item` added at the end of the group at `groupPath`. */
export function addItem(group: FilterGroup, groupPath: ItemPath, item: FilterItem): FilterGroup {
  if (groupPath.length === 0) return { ...group, conditions: [...group.conditions, item] };
  return updateItem(group, groupPath, (inner) => (isGroup(inner) ? addItem(inner, [], item) : inner));
}

/** The group with the group at `groupPath` joined by `conjunction`. */
export function setConjunction(group: FilterGroup, groupPath: ItemPath, conjunction: 'and' | 'or'): FilterGroup {
  if (groupPath.length === 0) return { ...group, conjunction };
  return updateItem(group, groupPath, (inner) => (isGroup(inner) ? { ...inner, conjunction } : inner));
}

/** Whether a group may hold another: groups nest at most three deep, the top one included. */
export function canNest(groupPath: ItemPath): boolean {
  return groupPath.length + 1 < MAX_FILTER_DEPTH;
}
