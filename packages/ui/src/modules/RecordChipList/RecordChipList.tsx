import type { RecordRefDisplay } from '@crm/contracts/values';
import { RecordChip } from '../../atoms/RecordChip/RecordChip.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { LoadStatus } from '../../lib/load-status.ts';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { strings } from './strings.ts';
import styles from './RecordChipList.module.css';

/** One record in the list: its chip, and the record page it opens. */
export interface RecordChipItem {
  readonly display: RecordRefDisplay;
  readonly href?: string;
}

/** Props for RecordChipList. */
export interface RecordChipListProps {
  /** What the records are ("Recently viewed"). */
  readonly label: string;
  readonly records: readonly RecordChipItem[];
  readonly status?: LoadStatus;
  readonly onRetry?: () => void;
  /** The empty state's title ("Nothing viewed yet"). */
  readonly emptyTitle: string;
  /** One line under the empty title. */
  readonly emptyText?: string;
}

/**
 * Records as RecordChips that wrap, each opening its record: Home's Recently
 * viewed. Loading draws two skeleton lines; empty and failed draw a row EmptyState.
 */
export function RecordChipList({
  label,
  records,
  status = 'ready',
  onRetry,
  emptyTitle,
  emptyText,
}: RecordChipListProps) {
  if (status === 'loading') {
    return (
      <div>
        <VisuallyHidden>{strings.loading}</VisuallyHidden>
        <Skeleton lines={2} />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <EmptyState tone="error" title={strings.failed} layout="row" {...(onRetry === undefined ? {} : { onRetry })}>
        {strings.failedBody}
      </EmptyState>
    );
  }
  if (status === 'no-access') return <EmptyState tone="locked" title={strings.noAccess} layout="row" />;
  if (records.length === 0) {
    return (
      <EmptyState title={emptyTitle} layout="row">
        {emptyText}
      </EmptyState>
    );
  }
  return (
    <ul className={styles.root} aria-label={label}>
      {records.map((record) => (
        <li key={`${record.display.objectId}:${record.display.recordId}`} className={styles.item}>
          <RecordChip display={record.display} {...(record.href === undefined ? {} : { href: record.href })} />
        </li>
      ))}
    </ul>
  );
}
