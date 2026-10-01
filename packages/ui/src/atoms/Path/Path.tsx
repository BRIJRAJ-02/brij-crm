import { Fragment } from 'react';
import { Icon } from '../Icon/Icon.tsx';
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden.tsx';
import { strings } from './strings.ts';
import styles from './Path.module.css';

/** Props for Path. */
export interface PathProps {
  /** The attributes in order, through relations: `['Company', 'Country']`. */
  readonly parts: readonly string[];
}

/** An attribute path through relations, Company › Country, in filters, formulas and variables. */
export function Path({ parts }: PathProps) {
  return (
    <span className={styles.root}>
      {parts.map((part, index) => (
        <Fragment key={`${String(index)}-${part}`}>
          {index > 0 && (
            <>
              <span className={styles.separator}>
                <Icon name="chevron-right" size="xs" />
              </span>
              <VisuallyHidden>{strings.then}</VisuallyHidden>
            </>
          )}
          <span className={styles.part}>{part}</span>
        </Fragment>
      ))}
    </span>
  );
}
