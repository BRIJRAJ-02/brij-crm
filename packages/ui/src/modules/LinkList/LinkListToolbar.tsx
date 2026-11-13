import type { ReactNode } from 'react';
import { Field } from '../../molecules/Field/Field.tsx';
import styles from './LinkListToolbar.module.css';
import { strings } from './strings.ts';

/** Props for LinkListToolbar. */
export interface LinkListToolbarProps {
  /** The search field's name ("Search booking pages"). */
  readonly searchLabel: string;
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  /** After the search: the list's own action (New booking page, New form). */
  readonly actions?: ReactNode;
  /** While the list loads or failed, the search waits. */
  readonly isSearchDisabled?: boolean;
  /** `sm` sits in a tab strip; `md` (the default) above the rows. */
  readonly size?: 'sm' | 'md';
}

/**
 * LinkList's search and action, for a page that draws them elsewhere: Captures puts them at the end of its
 * Links · Forms strip (the owner's call, 20 October 2026), with the list's `query` held by the page. Its own file, so
 * a page that draws only the search (the guest profile page) loads none of the list.
 */
export function LinkListToolbar({
  searchLabel,
  query,
  onQueryChange,
  actions,
  isSearchDisabled = false,
  size = 'md',
}: LinkListToolbarProps) {
  return (
    <div className={styles.toolbar} data-size={size}>
      <span className={styles.search}>
        <Field
          label={searchLabel}
          isLabelHidden
          placeholder={strings.search}
          variant="search"
          type="search"
          size={size}
          value={query}
          onChange={onQueryChange}
          isDisabled={isSearchDisabled}
        />
      </span>
      {actions !== undefined && <div className={styles.listActions}>{actions}</div>}
    </div>
  );
}
