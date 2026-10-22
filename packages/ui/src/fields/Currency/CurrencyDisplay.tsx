import type { CurrencyValue } from '@crm/contracts/values';
import { Currency } from '../../atoms/Currency/Currency.tsx';
import { EmptyValue } from '../parts.tsx';
import type { DisplayProps } from '../types.ts';

/** Currency: the symbol and the amount ($1,234.50), through the Currency atom. */
export function CurrencyDisplay({ value, surface }: DisplayProps<'currency'>) {
  if (value === null || Array.isArray(value)) return <EmptyValue surface={surface} />;
  // A grid's or a preview table's column keeps every amount's cents, so the digits line up down it (HubSpot's grid); a card, a panel
  // and a stat are read one value at a time, and a whole amount reads cleaner without them.
  return <Currency value={value as CurrencyValue} isFixedDecimals={surface === 'cell' || surface === 'preview'} />;
}
