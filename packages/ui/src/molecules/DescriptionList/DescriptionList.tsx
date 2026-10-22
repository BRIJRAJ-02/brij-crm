import type { ReactNode } from 'react';
import { CopyButton } from '../../atoms/Button/CopyButton.tsx';
import styles from './DescriptionList.module.css';

/** One term and its description. */
export interface DescriptionItem {
  /** Keys the row when terms repeat (a booking's chat lines, spec 0042); the term otherwise. */
  readonly id?: string;
  readonly term: string;
  readonly description: ReactNode;
  /**
   * A value to copy, with the copy button's name ("Copy email"): an icon button after the description, shown on
   * hover or focus with a pointer and always under a finger. The raw value, which can differ from what shows (a
   * phone shown as +91 77109 86909 copies +917710986909).
   */
  readonly copy?: { readonly value: string; readonly label: string };
}

/** Props for DescriptionList. */
export interface DescriptionListProps {
  readonly items: readonly DescriptionItem[];
  /** `columns` puts terms beside descriptions (the default); `stacked` puts each term above its description. */
  /**
   * `compact` is columns on a tight rhythm with the terms in one fixed narrow column, so short values line up
   * (a schedule's week: "Mon to Wed", "Thu").
   */
  readonly layout?: 'columns' | 'stacked' | 'compact';
}

/** Labelled values that are not attributes: an API key's scopes, a webhook's last delivery, an invoice's totals. */
export function DescriptionList({ items, layout = 'columns' }: DescriptionListProps) {
  return (
    <dl className={styles.root} data-layout={layout}>
      {items.map((item) => (
        <div key={item.id ?? item.term} className={styles.row}>
          <dt className={styles.term}>{item.term}</dt>
          <dd className={styles.description} data-copy={item.copy === undefined ? undefined : ''}>
            {item.copy === undefined ? (
              item.description
            ) : (
              <>
                <span className={styles.value}>{item.description}</span>
                <span className={styles.copy}>
                  <CopyButton value={item.copy.value} label={item.copy.label} isIconOnly variant="ghost" />
                </span>
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
