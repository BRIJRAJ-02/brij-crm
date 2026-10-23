import type { RecordRefDisplay } from '@crm/contracts/values';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { RecordChip } from '../../atoms/RecordChip/RecordChip.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { ResultState } from '../../fields/ReferencePicker.tsx';
import { focusLater } from '../../lib/focus-later.ts';
import { memoIntl } from '../../lib/intl-memo.ts';
import type { ListSource } from '../../lib/list-source.ts';
import type { LoadStatus } from '../../lib/load-status.ts';
import { Disclosure } from '../../molecules/Disclosure/Disclosure.tsx';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { Menu, MenuTrigger } from '../../molecules/Menu/Menu.tsx';
import { useFormatSettings } from '../../provider/context.ts';
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
  /** Focuses the section's heading (its fold toggle), or the short form's first row. */
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
   * no heading (the Card around it names the side), no Add or Remove, and a
   * "View all <N>" footer.
   */
  readonly limit?: number;
  /** The short form's "View all <N>": the screen moves to the full section. */
  readonly onViewAll?: () => void;
  /** The section's id. */
  readonly id?: string;
  /** Lets a screen move focus to the section ("View all" on Overview). */
  readonly ref?: Ref<RelatedRecordsHandle>;
}

const keyOf = (record: RelatedRecord) => `${record.display.objectId}:${record.display.recordId}`;

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
  const results = picker.onSearch(query);
  return (
    <MenuTrigger>
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
  onViewAll,
  id,
  ref,
}: RelatedRecordsProps) {
  const { locale } = useFormatSettings();
  const number = memoIntl(`plain:${locale}`, () => new Intl.NumberFormat(locale));
  const listRef = useRef<HTMLUListElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  // The row whose Remove was pressed: when it leaves, focus moves to the row now in its place.
  const leaving = useRef<{ readonly key: string; readonly index: number } | undefined>(undefined);
  useEffect(() => {
    const gone = leaving.current;
    if (gone === undefined || records.some((record) => keyOf(record) === gone.key)) return;
    leaving.current = undefined;
    focusLater(() => {
      // Only when focus fell to the page with the row (a confirm closing over it), never away from elsewhere.
      if (document.activeElement !== document.body && document.activeElement !== null) return undefined;
      const rows = listRef.current?.querySelectorAll<HTMLElement>(':scope > li');
      const row = rows === undefined ? undefined : (rows[Math.min(gone.index, rows.length - 1)] ?? undefined);
      return row?.querySelector<HTMLElement>('a, button') ?? sectionRef.current?.querySelector<HTMLElement>('button');
    });
  }, [records]);
  const isShort = limit !== undefined;
  const shown = isShort ? records.slice(0, limit) : records;
  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        sectionRef.current?.querySelector<HTMLElement>('button, a')?.focus();
      },
    }),
    [],
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
          : { actions: <AddPicker title={title} noun={noun} picker={picker} isLabelled /> })}
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
          <span className={styles.more}>
            <Button variant="ghost" icon="chevron-down" isPending={isLoadingMore} onPress={onShowMore}>
              {strings.showMore}
            </Button>
            {isMoreFailed && (
              <span className={styles.moreFailed} role="status">
                {strings.moreFailed}
              </span>
            )}
          </span>
        )}
      </>
    );
  }

  if (isShort) {
    const count = number.format(total ?? records.length);
    return (
      <div ref={sectionRef} id={id} className={styles.root}>
        {body}
        {status === 'ready' && shown.length > 0 && onViewAll !== undefined && (
          <span className={styles.more}>
            <Button
              variant="ghost"
              iconRight="arrow-right"
              label={strings.viewAllLabel(count, noun, title)}
              onPress={onViewAll}
            >
              {strings.viewAll(count)}
            </Button>
          </span>
        )}
      </div>
    );
  }
  return (
    <div ref={sectionRef} id={id} className={styles.root}>
      <Disclosure
        title={title}
        variant="label"
        defaultExpanded
        {...(total === undefined || status !== 'ready' ? {} : { count: total, countLabel: noun })}
        {...(picker === undefined || status !== 'ready'
          ? {}
          : { actions: <AddPicker title={title} noun={noun} picker={picker} isLabelled={false} /> })}
      >
        {body}
      </Disclosure>
    </div>
  );
}
