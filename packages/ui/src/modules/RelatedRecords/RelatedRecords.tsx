import type { RecordRefDisplay } from '@crm/contracts/values';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { LockReason } from '../../atoms/Tooltip/LockReason.tsx';
import { RecordChip } from '../../atoms/RecordChip/RecordChip.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { ResultState } from '../../fields/ReferencePicker.tsx';
import { focusLater } from '../../lib/focus-later.ts';
import { arraySource, type ListSource } from '../../lib/list-source.ts';
import type { LoadStatus } from '../../lib/load-status.ts';
import { Disclosure } from '../../molecules/Disclosure/Disclosure.tsx';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { Menu, MenuTrigger } from '../../molecules/Menu/Menu.tsx';
import styles from './RelatedRecords.module.css';
import { strings } from './strings.ts';

/** One related record: its chip, and the record page it opens. */
export interface RelatedRecord {
  readonly display: RecordRefDisplay;
  readonly href?: string;
}

/** Add's record search (spec 0014's picker): results from outside, each one's note, and the pick. */
export interface RelatedRecordsPicker {
  readonly onSearch: (query: string) => ListSource<RecordRefDisplay>;
  /** A result's note ("At Acme") and whether it is linked already (its check; picking it again does nothing). */
  readonly describeResult?: (display: RecordRefDisplay) => ResultState | undefined;
  readonly onPick: (display: RecordRefDisplay) => void;
}

/** What a screen can do with a section: move focus to it ("View all" on Overview). */
export interface RelatedRecordsHandle {
  /** Opens the section if it was folded and focuses its heading (its fold toggle), or the short form's first row. */
  readonly focus: () => void;
}

/** Props for RelatedRecords. */
export interface RelatedRecordsProps {
  /** The side's name ("Team"): the section's heading. */
  readonly title: string;
  /** What the records are, plural and lower case ("people"): the total, the empty line and the search. */
  readonly noun: string;
  readonly records: readonly RelatedRecord[];
  /** The exact total, which can be far more than the rows held. */
  readonly total?: number;
  readonly status?: LoadStatus;
  readonly onRetry?: () => void;
  /** More rows past the ones held: "Show more" asks for them. */
  readonly hasMore?: boolean;
  readonly isLoadingMore?: boolean;
  readonly onShowMore?: () => void;
  /** Show more failed: said under the rows, and pressing it again tries again. */
  readonly isMoreFailed?: boolean;
  /** Add, with its search. Leave it out where the side can't change (read only): no Add shows. */
  readonly picker?: RelatedRecordsPicker;
  /** A row's Remove. Leave it out where the side can't change: no Remove shows. */
  readonly onRemove?: (record: RelatedRecord) => void;
  /**
   * The short form (Overview's Related cards): the first `limit` rows with
   * no heading, no Add or Remove; the Card around it names the side and holds
   * its "View all <N>".
   */
  readonly limit?: number;
  /** Why the side can't change, when it can't (spec 0009): a lock after the heading says so. */
  readonly readOnlyReason?: string;
  /** The section's id. */
  readonly id?: string;
  /** Lets a screen move focus to the section ("View all" on Overview). */
  readonly ref?: Ref<RelatedRecordsHandle>;
}

/** What a closed Add offers: nothing, and nothing is asked. */
const NO_RESULTS: ListSource<RecordRefDisplay> = arraySource<RecordRefDisplay>([], (display) => display.recordId);

const keyOf = (record: RelatedRecord) => `${record.display.objectId}:${record.display.recordId}`;

/** The section heading's fold toggle. */
const headingOf = (root: HTMLElement | null) => root?.querySelector<HTMLElement>('button') ?? undefined;

/** The first row's chip, for the short form. */
const rowOrNull = (list: HTMLUListElement | null) => list?.querySelector<HTMLElement>('a, button') ?? undefined;

/** A related record's name for its Remove, or a word for one with none. */
const nameOf = (record: RelatedRecord) => (record.display.name === '' ? strings.unnamed : record.display.name);

/** Add: a button opening the record search, which links the record picked. */
function AddPicker({
  title,
  noun,
  picker,
  isLabelled,
}: {
  readonly title: string;
  readonly noun: string;
  readonly picker: RelatedRecordsPicker;
  readonly isLabelled: boolean;
}) {
  const [query, setQuery] = useState('');
  const [isOpen, setOpen] = useState(false);
  // Searched only while the menu is open: a screen's pickers keep one search at a time, so a closed Add on each
  // side asking on every draw would take the search from the others, and each answer would draw them all again.
  const results = isOpen ? picker.onSearch(query) : NO_RESULTS;
  return (
    <MenuTrigger
      isOpen={isOpen}
      onOpenChange={(open) => {
        setOpen(open);
        if (!open) setQuery('');
      }}
    >
      {isLabelled ? (
        <Button variant="ghost" icon="plus" label={strings.addTo(title)}>
          {strings.add}
        </Button>
      ) : (
        <Button variant="ghost" icon="plus" label={strings.addTo(title)} />
      )}
      <Menu<RecordRefDisplay>
        label={strings.addTo(title)}
        search={{ label: strings.search(noun), onSearch: setQuery }}
        source={results}
        renderItem={(display) => {
          const state = picker.describeResult?.(display);
          return {
            children: display.name === '' ? strings.unnamed : display.name,
            ...(state?.note === undefined ? {} : { description: state.note }),
            ...(state?.isLinked === true ? { isChecked: true } : {}),
          };
        }}
        onAction={(key) => {
          const found = Array.from({ length: results.count }, (_, index) => results.getItem(index)).find(
            (item) => item !== undefined && results.getKey(item) === String(key),
          );
          // Linked already: its check says so, and picking it again changes nothing.
          if (found === undefined || picker.describeResult?.(found)?.isLinked === true) return;
          picker.onPick(found);
        }}
      />
    </MenuTrigger>
  );
}

/**
 * A record's related records on one side that holds many (spec 0017,
 * milestone 3): in the record page's sidebar, a folding section titled by
 * the side with its total, the rows as RecordChips that open their records,
 * "Show more", "Add" and a Remove per row; in the short form (Overview's
 * cards), the first few rows and "View all <N>". Every state comes from
 * Skeleton and EmptyState.
 */
export function RelatedRecords({
  title,
  noun,
  records,
  total,
  status = 'ready',
  onRetry,
  hasMore = false,
  isLoadingMore = false,
  onShowMore,
  isMoreFailed = false,
  picker,
  onRemove,
  limit,
  readOnlyReason,
  id,
  ref,
}: RelatedRecordsProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  // The section's fold, so "View all" (through `focus`) can open one the person folded.
  const [isExpanded, setExpanded] = useState(true);
  // The row whose Remove was pressed: when it leaves, focus moves to the row now in its place.
  const leaving = useRef<{ readonly key: string; readonly index: number } | undefined>(undefined);
  // Show more pressed with this many rows: when more arrive, focus moves to the first of them.
  const moreFrom = useRef<number | undefined>(undefined);
  // A pick from the empty row's Add: when the first row arrives, it takes focus from the Add that left with the row.
  const pickedWhenEmpty = useRef(false);
  useEffect(() => {
    const rowControl = (index: number) => {
      const rows = listRef.current?.querySelectorAll<HTMLElement>(':scope > li');
      const row = rows === undefined ? undefined : rows[Math.min(index, rows.length - 1)];
      return row?.querySelector<HTMLElement>('a, button') ?? undefined;
    };
    // Only when focus fell to the page with the control it was on, never away from something else.
    const isLost = () => document.activeElement === document.body || document.activeElement === null;
    const gone = leaving.current;
    // The screen's confirm may hold focus: while it is open the row may still leave, and once it closes over a
    // row that left, focus moves on from it.
    const inConfirm = () =>
      document.activeElement instanceof HTMLElement &&
      document.activeElement.closest('[role="alertdialog"], [role="dialog"]') !== null;
    if (gone !== undefined) {
      if (!records.some((record) => keyOf(record) === gone.key)) {
        leaving.current = undefined;
        focusLater(() =>
          isLost() || inConfirm() ? (rowControl(gone.index) ?? headingOf(sectionRef.current)) : undefined,
        );
      } else if (!isLost() && !inConfirm()) {
        // Focus came back to the page (the confirm was cancelled): nothing is leaving.
        leaving.current = undefined;
      }
    }
    const from = moreFrom.current;
    if (from !== undefined && records.length > from) {
      moreFrom.current = undefined;
      focusLater(() => {
        const active = document.activeElement;
        const onMore = active instanceof HTMLElement && active.closest('[data-more]') !== null;
        return isLost() || onMore ? rowControl(from) : undefined;
      });
    }
    // The first record added to an empty side: its Add went with the empty row.
    if (pickedWhenEmpty.current && records.length > 0) {
      pickedWhenEmpty.current = false;
      focusLater(() => (isLost() ? rowControl(0) : undefined));
    }
  }, [records]);
  const isShort = limit !== undefined;
  const shown = isShort ? records.slice(0, limit) : records;
  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        setExpanded(true);
        focusLater(() => (isShort ? rowOrNull(listRef.current) : headingOf(sectionRef.current)));
      },
    }),
    [isShort],
  );

  let body;
  if (status === 'loading') {
    body = (
      <div className={styles.loading}>
        <VisuallyHidden>{strings.loading}</VisuallyHidden>
        {[0, 1, 2].map((row) => (
          <div key={row} className={styles.row}>
            <Skeleton width={row === 1 ? 'long' : 'medium'} />
          </div>
        ))}
      </div>
    );
  } else if (status === 'error') {
    body = (
      <EmptyState tone="error" title={strings.failed} layout="row" {...(onRetry === undefined ? {} : { onRetry })}>
        {strings.failedBody}
      </EmptyState>
    );
  } else if (status === 'no-access') {
    body = <EmptyState tone="locked" title={strings.noAccess} layout="row" />;
  } else if (shown.length === 0) {
    body = (
      <EmptyState
        title={strings.empty(noun)}
        layout="row"
        {...(picker === undefined || isShort
          ? {}
          : {
              actions: (
                <AddPicker
                  title={title}
                  noun={noun}
                  picker={{
                    ...picker,
                    onPick: (display) => {
                      pickedWhenEmpty.current = true;
                      picker.onPick(display);
                    },
                  }}
                  isLabelled
                />
              ),
            })}
      />
    );
  } else {
    body = (
      <>
        <ul ref={listRef} className={styles.list} aria-label={title}>
          {shown.map((record, index) => (
            <li key={keyOf(record)} className={styles.row}>
              <span className={styles.chip}>
                <RecordChip display={record.display} {...(record.href === undefined ? {} : { href: record.href })} />
              </span>
              {onRemove !== undefined && !isShort && (
                <span className={styles.action}>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="x"
                    label={strings.remove(nameOf(record), title)}
                    onPress={() => {
                      leaving.current = { key: keyOf(record), index };
                      onRemove(record);
                    }}
                  />
                </span>
              )}
            </li>
          ))}
        </ul>
        {!isShort && hasMore && onShowMore !== undefined && (
          <span className={styles.more} data-more="">
            <Button
              variant="ghost"
              icon="chevron-down"
              isPending={isLoadingMore}
              onPress={() => {
                moreFrom.current = records.length;
                onShowMore();
              }}
            >
              {strings.showMore}
            </Button>
          </span>
        )}
      </>
    );
  }
  // Kept in place, so "More didn't load" is announced as it arrives.
  const moreStatus = isShort ? null : (
    <span className={styles.moreFailed} role="status">
      {isMoreFailed && status === 'ready' ? strings.moreFailed : ''}
    </span>
  );

  if (isShort) {
    return (
      <div ref={sectionRef} id={id} className={styles.root}>
        {body}
      </div>
    );
  }
  const lock = readOnlyReason === undefined ? undefined : <LockReason reason={readOnlyReason} size="sm" />;
  // Add sits after the heading once the side holds records; an empty side offers it in its empty row instead.
  const add =
    picker === undefined || status !== 'ready' || records.length === 0 ? undefined : (
      <AddPicker title={title} noun={noun} picker={picker} isLabelled={false} />
    );
  return (
    <div ref={sectionRef} id={id} className={styles.root}>
      <Disclosure
        title={title}
        variant="label"
        isExpanded={isExpanded}
        onExpandedChange={setExpanded}
        {...(total === undefined || status !== 'ready' ? {} : { count: total, countLabel: noun })}
        {...(add === undefined && lock === undefined
          ? {}
          : {
              actions: (
                <>
                  {lock}
                  {add}
                </>
              ),
            })}
      >
        {body}
        {moreStatus}
      </Disclosure>
    </div>
  );
}
