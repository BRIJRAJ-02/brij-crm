import { Checkbox, type CheckboxProps } from './Checkbox.tsx';
import styles from './CheckboxRow.module.css';

/**
 * A Checkbox drawn as a full width row, its description at the row's end, after checklabs' add-on rows: a dish's add-ons
 * on the guest menu, beside RadioRowsGroup for its sizes. Apart from Checkbox so its styles load only where it is drawn.
 */
export function CheckboxRow(props: Omit<CheckboxProps, 'look'>) {
  return <Checkbox {...props} look={styles} />;
}
