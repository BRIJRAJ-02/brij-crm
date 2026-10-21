import type { ReactNode } from 'react';
import styles from './DescriptionList.module.css';

/** One term and its description. */
export interface DescriptionItem {
  /** Keys the row when terms repeat (a booking's chat lines, spec 0041); the term otherwise. */
  readonly id?: string;
  readonly term: string;
  readonly description: ReactNode;
}

/** Props for DescriptionList. */
export interface DescriptionListProps {
  readonly items: readonly DescriptionItem[];
  /** `columns` puts terms beside descriptions (the default); `stacked` puts each term above its description. */
  readonly layout?: 'columns' | 'stacked';
}

/** Labelled values that are not attributes: an API key's scopes, a webhook's last delivery, an invoice's totals. */
export function DescriptionList({ items, layout = 'columns' }: DescriptionListProps) {
  return (
    <dl className={styles.root} data-layout={layout}>
      {items.map((item) => (
        <div key={item.id ?? item.term} className={styles.row}>
          <dt className={styles.term}>{item.term}</dt>
          <dd className={styles.description}>{item.description}</dd>
        </div>
      ))}
    </dl>
  );
}
