// The formula functions (spec 0015, 0015-formulas.md): each one's name, its
// signature for the editor's suggestions and its one line description. How
// each checks its arguments lives in `check.ts`, how it runs in `evaluate.ts`.

/** A formula value's type. `empty` is BLANK(), which fits wherever any type fits. */
export type FormulaType = 'number' | 'currency' | 'text' | 'date' | 'timestamp' | 'bool' | 'empty';

/** One function as the editor lists it. */
export interface FormulaFunction {
  readonly name: string;
  readonly signature: string;
  readonly description: string;
}

/** Every function, in the order the editor suggests them. */
export const FUNCTIONS: readonly FormulaFunction[] = [
  {
    name: 'IF',
    signature: 'IF(condition, then, else)',
    description: 'One value when the condition holds, else another.',
  },
  { name: 'AND', signature: 'AND(a, b, …)', description: 'Yes when every one is yes.' },
  { name: 'OR', signature: 'OR(a, b, …)', description: 'Yes when any one is yes.' },
  { name: 'NOT', signature: 'NOT(a)', description: 'Yes becomes no, no becomes yes.' },
  { name: 'ISBLANK', signature: 'ISBLANK(x)', description: 'Yes when x is empty.' },
  { name: 'BLANK', signature: 'BLANK()', description: 'An empty value.' },
  { name: 'COALESCE', signature: 'COALESCE(a, b, …)', description: 'The first one that isn’t empty.' },
  { name: 'ROUND', signature: 'ROUND(x, digits)', description: 'Rounds to 0 to 4 decimals.' },
  { name: 'ABS', signature: 'ABS(x)', description: 'The value without its sign.' },
  { name: 'MIN', signature: 'MIN(a, b, …)', description: 'The smallest number or earliest date.' },
  { name: 'MAX', signature: 'MAX(a, b, …)', description: 'The largest number or latest date.' },
  { name: 'AMOUNT', signature: 'AMOUNT(x)', description: 'A currency amount as a number.' },
  { name: 'CURRENCY', signature: 'CURRENCY(x, "USD")', description: 'A number as an amount in a currency.' },
  { name: 'LEN', signature: 'LEN(text)', description: 'How many characters.' },
  { name: 'UPPER', signature: 'UPPER(text)', description: 'In capitals.' },
  { name: 'LOWER', signature: 'LOWER(text)', description: 'In small letters.' },
  { name: 'TRIM', signature: 'TRIM(text)', description: 'Without spaces at either end.' },
  { name: 'CONTAINS', signature: 'CONTAINS(text, part)', description: 'Yes when the text holds the part.' },
  { name: 'CONCAT', signature: 'CONCAT(a, b, …)', description: 'Joins values as text.' },
  { name: 'TEXT', signature: 'TEXT(x)', description: 'Any value as text.' },
  { name: 'DATE', signature: 'DATE(timestamp)', description: 'The day of a date and time.' },
  { name: 'DAYS', signature: 'DAYS(end, start)', description: 'Days from start to end.' },
  { name: 'ADD_DAYS', signature: 'ADD_DAYS(date, days)', description: 'A date some days later.' },
  { name: 'YEAR', signature: 'YEAR(date)', description: 'The year of a date.' },
  { name: 'MONTH', signature: 'MONTH(date)', description: 'The month of a date, 1 to 12.' },
  { name: 'DAY', signature: 'DAY(date)', description: 'The day of the month.' },
];

/** The function names, for lookups. */
export const FUNCTION_NAMES: ReadonlySet<string> = new Set(FUNCTIONS.map((each) => each.name));

/** How a type reads in a sentence ("Gives a number", "needs text"). */
export function typeWords(type: FormulaType): string {
  switch (type) {
    case 'number':
      return 'a number';
    case 'currency':
      return 'a currency amount';
    case 'text':
      return 'text';
    case 'date':
      return 'a date';
    case 'timestamp':
      return 'a date and time';
    case 'bool':
      return 'yes or no';
    case 'empty':
      return 'an empty value';
  }
}
