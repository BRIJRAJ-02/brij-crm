import { RadioGroup, type RadioGroupProps } from './Radio.tsx';
import styles from './RadioRows.module.css';

/**
 * A RadioGroup drawn as rows: each choice a full width row with its description at the row's end, after checklabs'
 * option rows (a dish's sizes and options on the guest menu, each with its price). Apart from RadioGroup so its styles
 * load only where it is drawn: the hosted form and the booking page never draw it.
 */
export function RadioRowsGroup(props: Omit<RadioGroupProps, 'variant' | 'look'>) {
  return <RadioGroup {...props} look={styles} />;
}
