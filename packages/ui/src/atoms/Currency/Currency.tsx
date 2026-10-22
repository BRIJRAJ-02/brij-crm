import type { CurrencyValue } from '@crm/contracts/values';
import { formatMoney } from '../../lib/format.ts';
import { useFormatSettings } from '../../provider/context.ts';
import styles from './Currency.module.css';

/** Props for Currency. */
export interface CurrencyProps {
  /** The amount and its currency. */
  readonly value: CurrencyValue;
  /** Always the currency's minor units ($58,500.00), so a table column lines up on its digits. */
  readonly isFixedDecimals?: boolean;
}

/**
 * An amount with its currency's symbol, in the viewer's language ($58,500,
 * $1,234.50, CA$12): the currency type's one display. A whole amount shows no
 * decimals; one with a fraction shows the currency's minor units at least and
 * 4 at most, exact from the stored decimal.
 */
export function Currency({ value, isFixedDecimals = false }: CurrencyProps) {
  const { locale } = useFormatSettings();
  return <span className={styles.root}>{formatMoney(value.amount, value.currency, locale, isFixedDecimals)}</span>;
}
