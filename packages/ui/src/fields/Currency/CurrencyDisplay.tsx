import type { CurrencyValue } from '@crm/contracts/values';
import { Currency } from '../../atoms/Currency/Currency.tsx';
import { EmptyValue } from '../parts.tsx';
import type { DisplayProps } from '../types.ts';

/** Currency: the code, then the amount (USD 1,234.50), through the Currency atom. */
export function CurrencyDisplay({ value, surface }: DisplayProps<'currency'>) {
  if (value === null || Array.isArray(value)) return <EmptyValue surface={surface} />;
  return <Currency value={value as CurrencyValue} />;
}
