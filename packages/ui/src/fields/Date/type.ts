import { withEmpty } from '../operators.ts';
import type { AttributeTypeDef } from '../types.ts';
import { refuse } from '../values.ts';
import { DateDisplay } from './DateDisplay.tsx';
import { DateEditor } from './DateEditor.tsx';
import { parseLocaleDate } from './parse-date.ts';

/** The date type: a calendar day with no time zone. */
export const dateType: AttributeTypeDef<'date'> = {
  type: 'date',
  icon: 'calendar',
  Display: DateDisplay,
  Editor: DateEditor,
  operators: () => withEmpty(['is', 'before', 'after', 'within']),
  toText: (value) => (typeof value === 'string' ? value : value.join(', ')),
  fromText: (text, context) =>
    parseLocaleDate(text, context.locale) ?? refuse(`“${text.trim()}” isn’t a date. Use 2026-10-08.`),
  align: 'start',
  editIn: 'popover',
};
