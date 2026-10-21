import type { ReactNode } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import styles from './ConditionRow.module.css';

/** Props for ConditionRow. */
export interface ConditionRowProps {
  /** The word before the controls: "When" on the first row, then "and" or "or" as the conditions join. */
  readonly lead: string;
  /** The condition's controls, each with its label hidden: what it reads, the comparison, the value. */
  readonly children: ReactNode;
  /** Names the remove button ("Remove condition 2"). */
  readonly removeLabel: string;
  /** Removes the condition; left out, the row has no remove button (a list's only row, or read only). */
  readonly onRemove?: () => void;
  readonly isDisabled?: boolean;
}

/**
 * One condition of a rule as a row (spec 0043): a muted lead word, its
 * controls side by side, and a remove button at the end. Under 480px of its
 * container the controls stack under the lead word.
 */
export function ConditionRow({ lead, children, removeLabel, onRemove, isDisabled = false }: ConditionRowProps) {
  return (
    <div className={styles.root}>
      <span className={styles.lead}>{lead}</span>
      <div className={styles.controls}>{children}</div>
      <span className={styles.end}>
        {onRemove !== undefined && (
          <Button variant="ghost" icon="x" label={removeLabel} isDisabled={isDisabled} onPress={onRemove} />
        )}
      </span>
    </div>
  );
}
