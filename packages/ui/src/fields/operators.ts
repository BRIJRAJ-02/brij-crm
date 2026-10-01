// Filter operators per type (spec 0003): each type lists its own, and every
// type adds is empty and is not empty.
import type { FilterOperator } from '@crm/contracts/values';
import type { OperandKind, OperatorDef } from './types.ts';

const OPERANDS: Readonly<Partial<Record<FilterOperator, OperandKind>>> = {
  contains: 'text',
  does_not_contain: 'text',
  first_name_is: 'text',
  last_name_is: 'text',
  locality_is: 'text',
  region_is: 'text',
  name_contains: 'text',
  between: 'range',
  is_any_of: 'list',
  contains_any_of: 'list',
  contains_all_of: 'list',
  contains_none_of: 'list',
  within: 'relative',
  within_last: 'relative',
  is_me: 'none',
  is_empty: 'none',
  is_not_empty: 'none',
  is_checked: 'none',
  is_not_checked: 'none',
  has_files: 'none',
  through: 'through',
};

/** A type's operators, in order, with is empty and is not empty after them. */
export function withEmpty(operators: readonly FilterOperator[]): readonly OperatorDef[] {
  return [...operators, 'is_empty' as const, 'is_not_empty' as const].map((operator) => ({
    operator,
    operand: OPERANDS[operator] ?? 'value',
  }));
}
