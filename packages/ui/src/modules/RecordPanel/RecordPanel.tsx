// The record panel (spec 0003, the record views): a record opened beside the
// table, in the floating Panel, with its avatar and name, a way to step to the
// record before or after, one to open its full page, and its tabs.
import type { RecordRefDisplay } from '@crm/contracts/values';
import { useEffect, useRef, type ReactNode } from 'react';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Button } from '../../atoms/Button/Button.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import type { LoadStatus } from '../../lib/load-status.ts';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { Panel, type PanelWidth } from '../../molecules/Panel/Panel.tsx';
import { TabPanel, Tabs, type TabItem } from '../../molecules/Tabs/Tabs.tsx';
import styles from './RecordPanel.module.css';
import { strings } from './strings.ts';

/** One of the panel's tabs, and what it shows: details, activity, tasks, notes. */
export interface RecordPanelTab extends TabItem {
  readonly content: ReactNode;
}

/** Props for RecordPanel. */
export interface RecordPanelProps {
  /** The record: its name, kind, and picture or hue. Leave it out while it loads. */
  readonly record?: RecordRefDisplay;
  /** `loading` (skeletons in place of the tabs), `error`, or `no-access`, for the record as a whole. */
  readonly status?: LoadStatus;
  /** Try again, when `status` is `error`. */
  readonly onRetry?: () => void;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly tabs: readonly RecordPanelTab[];
  readonly selectedTab?: string;
  readonly onTabChange?: (id: string) => void;
  /** Steps to the record above or below in the view; leave one out at either end of the list. */
  readonly onPrevious?: () => void;
  readonly onNext?: () => void;
  /** Opens the record's full page. */
  readonly onOpenPage?: () => void;
  /** More of the header's actions, such as the record's menu. */
  readonly actions?: ReactNode;
  readonly width?: PanelWidth;
}

/**
 * A record beside the table, in the floating panel: the record's avatar and
 * name as its title, Previous and Next to step through the view without
 * closing it, Open full page, then its tabs, each filling the panel's height
 * so a feed or task list scrolls inside it. Focus moves in when it opens, and
 * Esc closes it.
 */
export function RecordPanel({
  record,
  isOpen,
  onClose,
  tabs,
  selectedTab,
  onTabChange,
  onPrevious,
  onNext,
  onOpenPage,
  actions,
  width = 'md',
  status = 'ready',
  onRetry,
}: RecordPanelProps) {
  const hasSteps = onPrevious !== undefined || onNext !== undefined;
  const previousRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const atStart = onPrevious === undefined;
  const atEnd = onNext === undefined;
  // Stepping onto the first or last record disables the button in use; focus moves to the other one.
  useEffect(() => {
    const active = document.activeElement;
    const lost = active === null || active === document.body;
    if (atEnd && (lost || active === nextRef.current)) previousRef.current?.focus();
    else if (atStart && (lost || active === previousRef.current)) nextRef.current?.focus();
  }, [atStart, atEnd]);
  const isReady = status === 'ready' && record !== undefined;
  let content: ReactNode;
  if (status === 'error') {
    content = <EmptyState tone="error" title={strings.failed} {...(onRetry === undefined ? {} : { onRetry })} />;
  } else if (status === 'no-access') {
    content = (
      <EmptyState tone="locked" title={strings.noAccess}>
        {strings.noAccessBody}
      </EmptyState>
    );
  } else if (!isReady) {
    content = (
      <div className={styles.content} aria-busy="true">
        <Skeleton lines={3} />
      </div>
    );
  }
  return (
    <Panel
      title={record?.name ?? strings.loading}
      variant="floating"
      isFlush
      width={width}
      isOpen={isOpen}
      onClose={onClose}
      leading={
        record !== undefined && (
          <Avatar
            name={record.name}
            id={record.recordId}
            size="sm"
            shape={record.kind === 'person' ? 'circle' : 'square'}
            isDecorative
            {...(record.imageSrc === undefined ? {} : { src: record.imageSrc })}
            {...(record.hue === undefined ? {} : { hue: record.hue })}
          />
        )
      }
      actions={
        <>
          {hasSteps && (
            <>
              <Button
                ref={previousRef}
                variant="ghost"
                icon="chevron-up"
                label={strings.previous}
                isDisabled={onPrevious === undefined}
                {...(onPrevious === undefined ? {} : { onPress: onPrevious })}
              />
              <Button
                ref={nextRef}
                variant="ghost"
                icon="chevron-down"
                label={strings.next}
                isDisabled={onNext === undefined}
                {...(onNext === undefined ? {} : { onPress: onNext })}
              />
            </>
          )}
          {onOpenPage !== undefined && (
            <Button variant="ghost" icon="maximize-2" label={strings.openPage} onPress={onOpenPage} />
          )}
          {actions}
        </>
      }
    >
      {content ?? (
        <Tabs
          label={record?.name ?? strings.loading}
          tabs={tabs}
          {...(selectedTab === undefined ? {} : { selectedKey: selectedTab })}
          {...(onTabChange === undefined ? {} : { onSelectionChange: onTabChange })}
        >
          {tabs.map((tab) => (
            <TabPanel key={tab.id} id={tab.id}>
              <div className={styles.content}>{tab.content}</div>
            </TabPanel>
          ))}
        </Tabs>
      )}
    </Panel>
  );
}
