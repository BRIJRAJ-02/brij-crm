import { Icon } from '../Icon/Icon.tsx';
import { Path } from '../Path/Path.tsx';
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden.tsx';
import { strings } from './strings.ts';
import styles from './Variable.module.css';

/** Props for Variable. */
export interface VariableProps {
  /** The attribute it stands for, through relations: `['Company', 'Name']`. */
  readonly path: readonly string[];
  /** The record has no value here, so the email or sequence would send a gap. */
  readonly isMissing?: boolean;
}

/** A merge variable in an email or a sequence step, standing for an attribute; orange when the record has no value. */
export function Variable({ path, isMissing = false }: VariableProps) {
  return (
    <span className={styles.root} data-missing={isMissing || undefined}>
      <Icon name="braces" size="xs" />
      <Path parts={path} />
      {isMissing && <VisuallyHidden> {strings.missing}</VisuallyHidden>}
    </span>
  );
}
