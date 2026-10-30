import { CURRENCY_CODES, type CurrencyValue } from '@crm/contracts/values';
import { parseAmount } from '../../lib/parse-input.ts';
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
  fromText: (given, context) => {
    // "$1,200", "900 €", "1,200 USD", "1.2k" and "(300)" read as the editor reads them (`parseAmount`).
    const parsed = parseAmount(given, { locale: context.locale, defaultCurrency: context.attribute.defaultCurrency });
    if (parsed === undefined) return refuse(`“${given.trim()}” isn’t an amount.`);
    const code = parsed.currency ?? context.attribute.defaultCurrency ?? '';
    if (!CODES.has(code)) return refuse(`Add a currency code, such as USD ${parsed.amount}.`);
    return { amount: parsed.amount, currency: code as CurrencyValue['currency'] };
  },
  align: 'end',
  editIn: 'cell',
  width: 'default',
};
