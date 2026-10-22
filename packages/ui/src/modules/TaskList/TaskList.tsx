// Tasks (spec 0003, the record views; spec 0019's variants): a list of to
// dos, each with a done checkbox, its title, the records it is about (the
// first as a chip, "+N" for the rest), its due day and who has it. Tasks come
// through a ListSource, and only the rows on screen draw. `sectionOf` heads
// runs of tasks (Overdue, Today), `inline` draws a few in place (Overview),
// and `newIds` marks tasks just made.
import type { ActorDisplay, RecordRefDisplay } from '@crm/contracts/values';
import { parseDate } from '@internationalized/date';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  Collection,
  GridList,
  GridListHeader,
  GridListItem,
  GridListSection,
  ListLayout,
  Virtualizer,
} from 'react-aria-components';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import { Button } from '../../atoms/Button/Button.tsx';
import { Checkbox } from '../../atoms/Checkbox/Checkbox.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { LockReason } from '../../atoms/Tooltip/LockReason.tsx';
import { RecordChip } from '../../atoms/RecordChip/RecordChip.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { ChipRow } from '../../fields/parts.tsx';
import { focusLater } from '../../lib/focus-later.ts';
import { formatDate, formatDateInYear } from '../../lib/format.ts';
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
  /** The records it is about, the one to show first, first: it shows as a chip, the rest as "+N". */
  readonly records?: readonly RecordRefDisplay[];
  /** How many records it is about, when more than `records` lists. */
  readonly recordCount?: number;
  /** Why this task can't be ticked by the viewer; its checkbox is read only and a lock says why. */
  readonly readOnlyReason?: string;
}

/** A run of tasks under one heading ("Overdue", "Today"). */
export interface TaskSection {
  readonly id: string;
  readonly title: string;
}

/** How the list lays out: scrolling inside its slot, or a few rows drawn in place. */
export type TaskListLayout = 'list' | 'inline';

/** The most rows the inline layout draws. */
export const INLINE_TASKS = 10;

/** Props for TaskList. */
export interface TaskListProps {
  /** The list's name ("Tasks", "My tasks"). */
  readonly label: string;
  readonly tasks: ListSource<TaskEntry>;
  /** The done checkbox changed. */
  readonly onToggle: (task: TaskEntry, isDone: boolean) => void;
  /** Enter or a click on a row: open the task. */
  readonly onAction?: (task: TaskEntry) => void;
  /** Hide the record chips. */
  readonly hideRecord?: boolean;
  /** Nobody here can tick tasks: every checkbox is read only. */
  readonly isReadOnly?: boolean;
  readonly status?: LoadStatus;
  /** Try again, when `status` is `error`. */
  readonly onRetry?: () => void;
  /** A linked record's page, for its chip. */
  readonly recordHref?: (record: RecordRefDisplay) => string | undefined;
  /** The heading a task sits under; a heading row draws before the first task of each section. */
  readonly sectionOf?: (task: TaskEntry) => TaskSection | undefined;
  /** `list` fills its slot and scrolls inside it; `inline` draws at most 10 rows in place (Overview). */
  readonly layout?: TaskListLayout;
  /** Tasks just made here: each shows the "New" badge. */
  readonly newIds?: ReadonlySet<string>;
  /** What an empty list says, in place of the library's own words. */
  readonly emptyTitle?: string;
  /** The line under `emptyTitle`. */
  readonly emptyBody?: string;
  /** The inline layout's most rows (10 by default); a list in a scrolling slot passes more and pages as it shows them. */
  readonly maxRows?: number;
  /**
   * Drawn above the list in the module's own column (a record's quick add):
   * it stays in every state, so the field is there when the list is empty.
   */
  readonly toolbar?: ReactNode;
  /** Drawn under the list in the same column, scrolling inside itself past half the slot (the Completed part). */
  readonly footer?: ReactNode;
  /**
   * The inline layout's next page, as a "Show more" button under the rows:
   * a list drawn in place has no scroll of its own to page by. Absent when
   * nothing more waits.
   */
  readonly onShowMore?: () => void;
  /** The next page is being read: "Show more" shows it pending. */
  readonly isLoadingMore?: boolean;
}

/** A run of rows, with the heading it sits under (none for rows before the first heading). */
interface RowGroup {
  readonly section?: TaskSection;
  readonly rows: readonly KeyedRow[];
}

/**
 * The rows split into runs by section: a run starts wherever a loaded task's
 * section differs from the run's; rows still loading stay in the run they
 * follow.
 */
function groupRows(
  rows: readonly KeyedRow[],
  tasks: ListSource<TaskEntry>,
  sectionOf: (task: TaskEntry) => TaskSection | undefined,
): readonly RowGroup[] {
  const groups: { section?: TaskSection; rows: KeyedRow[] }[] = [];
  let current: { section?: TaskSection; rows: KeyedRow[] } | undefined;
  for (const row of rows) {
    const task = tasks.getItem(row.index);
    const section = task === undefined ? current?.section : sectionOf(task);
    if (current === undefined || current.section?.id !== section?.id) {
      current = section === undefined ? { rows: [] } : { section, rows: [] };
      groups.push(current);
    }
    current.rows.push(row);
  }
  return groups;
}

/** A due day as "Today", "Tomorrow", "Yesterday" or the date, and whether it has passed. */
function useDueOf(): (dueOn: string) => { readonly text: string; readonly isPast: boolean } {
  const { locale, timeZone, dateFormat } = useFormatSettings();
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
            : // This year's days leave out the year, as lists of dates do (Linear, Attio); another year's keep it.
              parseDate(dueOn).year === today.year
              ? formatDateInYear(dueOn, locale, dateFormat)
              : formatDate(dueOn, locale, dateFormat);
    return { text, isPast: days < 0 };
  };
}

/**
 * Tasks as a React Aria grid list: a done checkbox, the title (struck through
 * once done), the records it is about, the due day (in the danger colour once
 * it has passed) and the assignee. The arrows move between rows (section
 * headings are skipped), and left and right reach a row's checkbox and
 * record; Enter opens the task. Only the rows on screen draw, and those not
 * loaded yet draw as skeletons.
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
  recordHref,
  sectionOf,
  layout = 'list',
  newIds,
  emptyTitle,
  emptyBody,
  maxRows = INLINE_TASKS,
  toolbar,
  footer,
  onShowMore,
  isLoadingMore = false,
}: TaskListProps) {
  // Whether "Show more" had focus: when the last page lands it goes, and focus moves to the list's last row.
  const moreHadFocus = useRef(false);
  const hasMore = onShowMore !== undefined;
  useEffect(() => {
    if (hasMore || !moreHadFocus.current) return;
    moreHadFocus.current = false;
    focusLater(() => {
      const rows = document.querySelectorAll<HTMLElement>(
        `[role="grid"][aria-label="${CSS.escape(label)}"] [role="row"]`,
      );
      return rows[rows.length - 1];
    });
  }, [hasMore, label]);
  const list = (
    <TaskListContent
      {...{ label, tasks, onToggle, hideRecord, isReadOnly, status, layout, maxRows }}
      isFramed={toolbar !== undefined || footer !== undefined}
      {...(onAction === undefined ? {} : { onAction })}
      {...(onRetry === undefined ? {} : { onRetry })}
      {...(recordHref === undefined ? {} : { recordHref })}
      {...(sectionOf === undefined ? {} : { sectionOf })}
      {...(newIds === undefined ? {} : { newIds })}
      {...(emptyTitle === undefined ? {} : { emptyTitle })}
      {...(emptyBody === undefined ? {} : { emptyBody })}
    />
  );
  const content =
    onShowMore === undefined || layout !== 'inline' || status !== 'ready' ? (
      list
    ) : (
      <>
        {list}
        <span
          className={styles.showMore}
          onFocus={() => {
            moreHadFocus.current = true;
          }}
          onBlur={() => {
            moreHadFocus.current = false;
          }}
        >
          <Button variant="ghost" onPress={onShowMore} isPending={isLoadingMore}>
            {strings.showMore}
          </Button>
        </span>
      </>
    );
  if (toolbar === undefined && footer === undefined) return content;
  return (
    <div className={styles.frame}>
      {toolbar !== undefined && <div className={styles.toolbar}>{toolbar}</div>}
      {/* Empty, the list takes only its row, so the part under it (Completed) follows rather than sinking. */}
      <div className={styles.body} data-empty={(status === 'ready' && tasks.count === 0) || undefined}>
        {content}
      </div>
      {footer !== undefined && <div className={styles.footer}>{footer}</div>}
    </div>
  );
}

/** The list itself, in whichever state it is. */
function TaskListContent({
  label,
  tasks,
  onToggle,
  onAction,
  hideRecord = false,
  isReadOnly = false,
  status = 'ready',
  onRetry,
  recordHref,
  sectionOf,
  layout = 'list',
  newIds,
  emptyTitle,
  emptyBody,
  maxRows = INLINE_TASKS,
  isFramed = false,
}: Omit<TaskListProps, 'toolbar' | 'footer' | 'onShowMore' | 'isLoadingMore'> & {
  /** A toolbar or a footer sits with it: an empty list says so in a row, so what follows stays near. */
  readonly isFramed?: boolean;
}) {
  const showSkeleton = useDelayedLoading(status === 'loading');
  const onShown = useRangeReporter(tasks);
  const dueOf = useDueOf();
  const isInline = layout === 'inline';
  const rows = useMemo(() => {
    const all = keyedRows(tasks);
    return isInline ? all.slice(0, maxRows) : all;
  }, [tasks, isInline, maxRows]);
  const groups = useMemo(
    () => (sectionOf === undefined ? undefined : groupRows(rows, tasks, sectionOf)),
    [rows, tasks, sectionOf],
  );

  if (status === 'error') {
    return (
      <EmptyState
        tone="error"
        // In place (a card on Home) or framed, the failure takes one row, like the empty list would, with the
        // warning icon every failed row shows.
        {...(isInline || isFramed ? { layout: 'row' as const } : { icon: 'list-todo' as const })}
        title={strings.failed}
        {...(onRetry === undefined ? {} : { onRetry })}
      >
        {strings.failedBody}
      </EmptyState>
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
      <div className={styles.root} data-inline={isInline || undefined} aria-busy="true">
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
  if (rows.length === 0) {
    return (
      <EmptyState
        icon="list-todo"
        title={emptyTitle ?? strings.empty}
        // A list drawn in place, or with a quick add above and more under it, says so in one row of its own size.
        layout={isInline || isFramed ? 'row' : 'block'}
      >
        {emptyBody ?? (emptyTitle === undefined ? strings.emptyBody : undefined)}
      </EmptyState>
    );
  }

  const renderRow = (row: KeyedRow): ReactNode => {
    const task = tasks.getItem(row.index);
    if (task === undefined) {
      return (
        <GridListItem id={row.id} className={styles.row} textValue="" isDisabled data-loading="">
          <RowShown index={row.index} onShown={onShown} />
          <Skeleton width="long" />
        </GridListItem>
      );
    }
    const due = task.dueOn === undefined ? undefined : dueOf(task.dueOn);
    const isOverdue = due?.isPast === true && !task.isDone;
    const records = task.records ?? [];
    const isNew = newIds?.has(task.id) === true;
    return (
      <GridListItem
        id={row.id}
        className={styles.row}
        textValue={task.title}
        data-done={task.isDone || undefined}
        data-pressable={onAction === undefined ? undefined : ''}
      >
        <RowShown index={row.index} onShown={onShown} />
        {/* Its own box that never shrinks: in a narrow row the checkbox was squeezed and drew over the title. */}
        <span className={styles.check}>
          <Checkbox
            label={strings.markDone(task.title)}
            isLabelHidden
            isSelected={task.isDone}
            isReadOnly={isReadOnly || task.readOnlyReason !== undefined}
            onChange={(isDone) => {
              onToggle(task, isDone);
            }}
          />
        </span>
        {task.readOnlyReason !== undefined && (
          <span className={styles.keep}>
            <LockReason reason={task.readOnlyReason} />
          </span>
        )}
        <span className={styles.title}>
          {task.title}
          {task.isDone && <VisuallyHidden>{`, ${strings.done}`}</VisuallyHidden>}
        </span>
        {isNew && (
          <span className={styles.keep}>
            <Badge text={strings.isNew} tone="accent" />
          </span>
        )}
        {!hideRecord && records.length > 0 && (
          <span className={styles.record}>
            {/* The field set's one row of records: the first chip, then "+N", which opens every one as a link. */}
            <ChipRow
              label={strings.records}
              maxVisible={1}
              chips={records.map((record) => {
                const href = recordHref?.(record);
                return {
                  key: record.recordId,
                  node: <RecordChip display={record} isFlat {...(href === undefined ? {} : { href })} />,
                };
              })}
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
  };

  // Rows follow their task; the collection draws them again when the tasks behind them change.
  const dependencies = [tasks, hideRecord, isReadOnly, dueOf, recordHref, newIds];
  const actions =
    onAction === undefined
      ? {}
      : {
          onAction: (key: string | number) => {
            const task = itemOfKey(tasks, rows, key);
            if (task !== undefined) onAction(task);
          },
        };
  const list =
    groups === undefined ? (
      <GridList
        className={styles.root}
        data-inline={isInline || undefined}
        aria-label={label}
        items={rows}
        dependencies={dependencies}
        {...actions}
      >
        {renderRow}
      </GridList>
    ) : (
      <GridList className={styles.root} data-inline={isInline || undefined} aria-label={label} {...actions}>
        {groups.map((group, index) =>
          group.section === undefined ? (
            <Collection key={`rows:${String(index)}`} items={group.rows} dependencies={dependencies}>
              {renderRow}
            </Collection>
          ) : (
            <GridListSection
              key={`section:${group.section.id}:${String(index)}`}
              id={`section:${group.section.id}:${String(index)}`}
            >
              <GridListHeader className={styles.heading}>{group.section.title}</GridListHeader>
              <Collection items={group.rows} dependencies={dependencies}>
                {renderRow}
              </Collection>
            </GridListSection>
          ),
        )}
      </GridList>
    );
  if (isInline) return list;
  return (
    <Virtualizer
      layout={ListLayout}
      layoutOptions={{ rowHeight: sizeToken('size-row'), headingHeight: sizeToken('size-row') }}
    >
      {list}
    </Virtualizer>
  );
}
