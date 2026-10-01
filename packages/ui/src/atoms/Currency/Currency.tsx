import type { CurrencyValue } from '@crm/contracts/values';
import { formatAmount } from '../../lib/format.ts';
import { useFormatSettings } from '../../provider/context.ts';
import styles from './Currency.module.css';

/** Props for Currency. */
export interface CurrencyProps {
  /** The amount and its currency. */
  readonly value: CurrencyValue;
}

/**
 * An amount as its currency code, then the digits in the viewer's format
 * (USD 1,234.50): the currency type's one display. The digits are exact, with
 * at least the currency's minor units and at most 4 decimals.
 */
export function Currency({ value }: CurrencyProps) {
  const { locale } = useFormatSettings();
  return (
    <span className={styles.root}>
      <span className={styles.code}>{value.currency}</span>
      {formatAmount(value.amount, value.currency, locale)}
    </span>
  );
}
