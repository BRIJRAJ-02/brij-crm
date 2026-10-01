import { CURRENCY_CODES, toCanonicalDecimal, type CurrencyValue } from '@crm/contracts/values';
import { parseLocaleDecimal } from '../../lib/decimal.ts';
import { withEmpty } from '../operators.ts';
import type { AttributeTypeDef } from '../types.ts';
import { refuse } from '../values.ts';
import { CurrencyDisplay } from './CurrencyDisplay.tsx';
import { CurrencyEditor } from './CurrencyEditor.tsx';

const CODES = new Set<string>(CURRENCY_CODES);

/** The currency type: an exact amount and its currency, both on the value. */
export const currencyType: AttributeTypeDef<'currency'> = {
  type: 'currency',
  icon: 'circle-dollar-sign',
  Display: CurrencyDisplay,
  Editor: CurrencyEditor,
  operators: () => withEmpty(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between']),
  toText: (value) => {
    const one = value as CurrencyValue;
    return `${one.currency} ${one.amount}`;
  },
  fromText: (text, context) => {
    const match = /^\s*([a-z]{3})?\s*(.+?)\s*$/i.exec(text);
    const code = (match?.[1] ?? context.attribute.defaultCurrency ?? '').toUpperCase();
    if (!CODES.has(code)) return refuse(`Add a currency code, such as USD ${match?.[2] ?? ''}.`.trim());
    const digits = match?.[2] ?? '';
    const amount = parseLocaleDecimal(digits, context.locale) ?? toCanonicalDecimal(digits);
    if (amount === undefined) return refuse(`“${digits}” isn’t an amount.`);
    return { amount, currency: code as CurrencyValue['currency'] };
  },
  align: 'end',
  editIn: 'cell',
};
