import { AttributeDisplay } from '../../fields/AttributeDisplay.tsx';
import type { FieldAttribute, Surface } from '../../fields/types.ts';
import styles from './FieldSurfaces.module.css';
import { strings } from './strings.ts';

/** Props for FieldSurfaces. */
export interface FieldSurfacesProps {
  readonly attribute: FieldAttribute;
  readonly value: unknown;
  readonly display?: unknown;
  readonly maxVisible?: number;
}

const SURFACES = ['cell', 'panel', 'card', 'filter', 'preview'] as const satisfies readonly Surface[];

/**
 * One value drawn on each surface the field set serves, labelled, for field
 * stories and previews. Stories only: it is not exported from `@crm/ui`.
 */
export function FieldSurfaces({ attribute, value, display, maxVisible }: FieldSurfacesProps) {
  return (
    <dl className={styles.root}>
      {SURFACES.map((surface) => (
        <div key={surface} className={styles.row}>
          <dt className={styles.surface}>{strings[surface]}</dt>
          <dd className={styles.slot} data-surface={surface}>
            <AttributeDisplay
              attribute={attribute}
              value={value as never}
              surface={surface}
              {...(display === undefined ? {} : { display: display as never })}
              {...(maxVisible === undefined ? {} : { maxVisible })}
            />
          </dd>
        </div>
      ))}
    </dl>
  );
}
