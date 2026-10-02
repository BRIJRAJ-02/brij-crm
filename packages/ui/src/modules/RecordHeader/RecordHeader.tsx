// The top of a record's page (spec 0003, the record views): its avatar, its
// name and object, who else is looking at it, and its actions.
import type { RecordRefDisplay } from '@crm/contracts/values';
import type { ReactNode } from 'react';
import { Avatar, AvatarStack, type AvatarStackPerson } from '../../atoms/Avatar/Avatar.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { useDelayedLoading } from '../../provider/useDelayedLoading.ts';
import styles from './RecordHeader.module.css';
import { strings } from './strings.ts';

/** Props for RecordHeader. */
export interface RecordHeaderProps {
  /** The record: its name, kind, and picture or hue. */
  readonly record?: RecordRefDisplay;
  /** Its object, singular ("Company"). */
  readonly objectName: string;
  /** After the object name: the domain, the job title. */
  readonly meta?: ReactNode;
  /** Who else has the record open now. */
  readonly viewers?: readonly AvatarStackPerson[];
  /** The end of the header: the record's buttons and menu. */
  readonly children?: ReactNode;
  /** The record is still coming: skeletons after the loading delay. */
  readonly isLoading?: boolean;
}

/**
 * The head of a record's page: a large avatar (a circle for a person, a
 * square for anything else), the name as the page's second level heading
 * under the top bar, the object and a line of detail, who else is viewing,
 * and the actions. In a narrow slot the actions wrap under the name.
 */
export function RecordHeader({
  record,
  objectName,
  meta,
  viewers = [],
  children,
  isLoading = false,
}: RecordHeaderProps) {
  const showSkeleton = useDelayedLoading(isLoading);
  if (isLoading || record === undefined) {
    return (
      <div className={styles.root} aria-busy="true">
        {showSkeleton && (
          <>
            <Skeleton shape="circle" />
            <span className={styles.text}>
              <Skeleton width="medium" />
              <Skeleton width="short" />
            </span>
          </>
        )}
        <VisuallyHidden>{strings.loading}</VisuallyHidden>
      </div>
    );
  }
  return (
    <header className={styles.root}>
      <Avatar
        name={record.name}
        id={record.recordId}
        size="lg"
        shape={record.kind === 'person' ? 'circle' : 'square'}
        isDecorative
        {...(record.imageSrc === undefined ? {} : { src: record.imageSrc })}
        {...(record.hue === undefined ? {} : { hue: record.hue })}
      />
      <span className={styles.text}>
        <h2 className={styles.name}>{record.name}</h2>
        <span className={styles.meta}>
          <span>{objectName}</span>
          {meta}
        </span>
      </span>
      {(viewers.length > 0 || children !== undefined) && (
        <span className={styles.end}>
          {viewers.length > 0 && (
            <span className={styles.viewers}>
              <VisuallyHidden>{strings.viewing}</VisuallyHidden>
              <AvatarStack people={viewers} />
            </span>
          )}
          {children}
        </span>
      )}
    </header>
  );
}
