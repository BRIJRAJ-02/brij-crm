// Tasks (spec 0003, the record views): a list of to dos, each with a done
// checkbox, its title, the record it is about, its due day and who has it.
// Tasks come through a ListSource, and only the rows on screen draw.
import type { ActorDisplay, RecordRefDisplay } from '@crm/contracts/values';
import { parseDate } from '@internationalized/date';
import { useMemo } from 'react';
import { GridList, GridListItem, ListLayout, Virtualizer } from 'react-aria-components';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Checkbox } from '../../atoms/Checkbox/Checkbox.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { LockReason } from '../../atoms/Tooltip/LockReason.tsx';
import { RecordChip } from '../../atoms/RecordChip/RecordChip.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { formatDate } from '../../lib/format.ts';
import { itemOfKey, keyedRows, type KeyedRow } from '../../lib/keyed-rows.ts';
import type { ListSource } from '../../lib/list-source.ts';
import type { LoadStatus } from '../../lib/load-status.ts';
import { RowShown, useRangeReporter } from '../../lib/range-reporter.tsx';
import { sizeToken } from '../../lib/token-values.ts';
import { dayIn } from '../../molecules/DatePicker/DatePicker.tsx';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { useFormatSettings, useNow } from '../../provider/context.ts';
import { useDelayedLoading } from '../../provider/useDelayedLoading.ts';
import styles from './TaskList.module.css';
import { strings } from './strings.ts';

/** One task. */
export interface TaskEntry {
  readonly id: string;
  readonly title: string;
  readonly isDone: boolean;
  /** The day it is due, `YYYY-MM-DD`. */
  readonly dueOn?: string;
  /** Who has it. */
  readonly assignee?: ActorDisplay;
  /** The record it is about, and that record's page. */
  readonly record?: RecordRefDisplay;
  readonly recordHref?: string;
  /** Why this task can't be ticked by the viewer; its checkbox is read only and a lock says why. */
  readonly readOnlyReason?: string;
}

/** Props for TaskList. */
export interface TaskListProps {
  /** The list's name ("Tasks", "My tasks"). */
  readonly label: string;
  readonly tasks: ListSource<TaskEntry>;
  /** The done checkbox changed. */
  readonly onToggle: (task: TaskEntry, isDone: boolean) => void;
  /** Enter or a click on a row: open the task. */
  readonly onAction?: (task: TaskEntry) => void;
  /** Hide the record chip, on the record's own page. */
  readonly hideRecord?: boolean;
  /** Nobody here can tick tasks: every checkbox is read only. */
  readonly isReadOnly?: boolean;
  readonly status?: LoadStatus;
  /** Try again, when `status` is `error`. */
  readonly onRetry?: () => void;
}

/** A due day as "Today", "Tomorrow", "Yesterday" or the date, and whether it has passed. */
function useDueOf(): (dueOn: string) => { readonly text: string; readonly isPast: boolean } {
  const { locale, timeZone } = useFormatSettings();
  const today = dayIn(useNow(), timeZone);
  return (dueOn) => {
    const days = parseDate(dueOn).compare(today);
    const text =
      days === 0
        ? strings.today
        : days === 1
          ? strings.tomorrow
          : days === -1
            ? strings.yesterday
            : formatDate(dueOn, locale);
    return { text, isPast: days < 0 };
  };
}

/**
 * Tasks as a React Aria grid list: a done checkbox, the title (struck through
 * once done), the record it is about, the due day (in the danger colour once it
 * has passed) and the assignee. The arrows move between rows, and left and
 * right reach a row's checkbox and record; Enter opens the task. Only the rows
 * on screen draw, and those not loaded yet draw as skeletons.
 */
export function TaskList({
  label,
  tasks,
  onToggle,
  onAction,
  hideRecord = false,
  isReadOnly = false,
  status = 'ready',
  onRetry,
}: TaskListProps) {
  const showSkeleton = useDelayedLoading(status === 'loading');
  const onShown = useRangeReporter(tasks);
  const dueOf = useDueOf();
  const count = tasks.count;
  const rows = useMemo(() => keyedRows(tasks), [tasks]);

  if (status === 'error') {
    return (
      <EmptyState
        tone="error"
        icon="list-todo"
        title={strings.failed}
        {...(onRetry === undefined ? {} : { onRetry })}
      />
    );
  }
  if (status === 'no-access') {
    return (
      <EmptyState tone="locked" title={strings.noAccess}>
        {strings.noAccessBody}
      </EmptyState>
    );
  }
  if (status === 'loading') {
    return (
      <div className={styles.root} aria-busy="true">
        {showSkeleton &&
          [0, 1, 2].map((row) => (
            <div key={row} className={styles.row}>
              <Skeleton width="long" />
            </div>
          ))}
        <VisuallyHidden>{strings.loading}</VisuallyHidden>
      </div>
    );
  }
  if (count === 0) {
    return (
      <EmptyState icon="list-todo" title={strings.empty}>
        {strings.emptyBody}
      </EmptyState>
    );
  }
  return (
    <Virtualizer layout={ListLayout} layoutOptions={{ rowHeight: sizeToken('size-row') }}>
      <GridList
        className={styles.root}
        aria-label={label}
        items={rows}
        // Rows follow their task; the collection draws them again when the tasks behind them change.
        dependencies={[tasks, hideRecord, isReadOnly, dueOf]}
        {...(onAction === undefined
          ? {}
          : {
              onAction: (key) => {
                const task = itemOfKey(tasks, rows, key);
                if (task !== undefined) onAction(task);
              },
            })}
      >
        {(row: KeyedRow) => {
          const task = tasks.getItem(row.index);
          if (task === undefined) {
            return (
              <GridListItem className={styles.row} textValue="" isDisabled>
                <RowShown index={row.index} onShown={onShown} />
                <Skeleton width="long" />
              </GridListItem>
            );
          }
          const due = task.dueOn === undefined ? undefined : dueOf(task.dueOn);
          const isOverdue = due?.isPast === true && !task.isDone;
          return (
            <GridListItem className={styles.row} textValue={task.title} data-done={task.isDone || undefined}>
              <RowShown index={row.index} onShown={onShown} />
              <Checkbox
                label={strings.markDone(task.title)}
                isLabelHidden
                isSelected={task.isDone}
                isReadOnly={isReadOnly || task.readOnlyReason !== undefined}
                onChange={(isDone) => {
                  onToggle(task, isDone);
                }}
              />
              {task.readOnlyReason !== undefined && <LockReason reason={task.readOnlyReason} />}
              <span className={styles.title}>
                {task.title}
                {task.isDone && <VisuallyHidden>{`, ${strings.done}`}</VisuallyHidden>}
              </span>
              {!hideRecord && task.record !== undefined && (
                <span className={styles.record}>
                  <RecordChip
                    display={task.record}
                    isFlat
                    {...(task.recordHref === undefined ? {} : { href: task.recordHref })}
                  />
                </span>
              )}
              {/* The due day and assignee keep their columns, so rows line up when one is missing. */}
              <span className={styles.due} data-overdue={isOverdue || undefined}>
                {due !== undefined && (
                  <>
                    {isOverdue && <Icon name="circle-alert" size="xs" />}
                    <VisuallyHidden>{isOverdue ? `${strings.overdue}, ` : `${strings.due} `}</VisuallyHidden>
                    {due.text}
                  </>
                )}
              </span>
              <span className={styles.assignee}>
                {task.assignee !== undefined && (
                  <Avatar
                    name={task.assignee.name}
                    id={task.assignee.id ?? task.assignee.name}
                    size="xs"
                    {...(task.assignee.imageSrc === undefined ? {} : { src: task.assignee.imageSrc })}
                    {...(task.assignee.hue === undefined ? {} : { hue: task.assignee.hue })}
                  />
                )}
              </span>
            </GridListItem>
          );
        }}
      </GridList>
    </Virtualizer>
  );
}
