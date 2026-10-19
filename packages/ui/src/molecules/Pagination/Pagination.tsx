import { Button } from '../../atoms/Button/Button.tsx';
import { Select } from '../Select/Select.tsx';
import styles from './Pagination.module.css';
import { strings } from './strings.ts';

/** Props for Pagination. */
export interface PaginationProps {
  /** What is paged ("Bookings"): names the controls. */
  readonly label: string;
  /** The page shown, from 1. */
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  /** The rows per page offered (10, 25, 50, 100). */
  readonly pageSizes: readonly number[];
  readonly onPage: (page: number) => void;
  /** A new page size; the caller goes back to the first page. */
  readonly onPageSize: (size: number) => void;
}

/**
 * A list's footer: rows per page at the start, "1–10 of 42" and the previous
 * and next buttons at the end (the Bookings list, spec 0025). Hidden with
 * nothing to page.
 */
export function Pagination({ label, page, pageSize, total, pageSizes, onPage, onPageSize }: PaginationProps) {
  if (total === 0) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return (
    <nav className={styles.root} aria-label={strings.navigation(label)}>
      <div className={styles.size}>
        <Select
          label={strings.rowsPerPage}
          isLabelHidden
          items={pageSizes.map((size) => ({ id: String(size), label: String(size) }))}
          value={String(pageSize)}
          onChange={(id) => {
            if (id !== null) onPageSize(Number(id));
          }}
        />
        <span className={styles.caption}>{strings.rowsPerPage}</span>
      </div>
      <div className={styles.pages}>
        <span className={styles.caption} aria-live="polite">
          {strings.range(first, last, total)}
        </span>
        <Button
          variant="ghost"
          icon="chevron-left"
          label={strings.previous}
          isDisabled={page <= 1}
          onPress={() => onPage(page - 1)}
        />
        <Button
          variant="ghost"
          icon="chevron-right"
          label={strings.next}
          isDisabled={page >= pages}
          onPress={() => onPage(page + 1)}
        />
      </div>
    </nav>
  );
}
