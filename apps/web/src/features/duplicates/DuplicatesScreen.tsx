// Brief
// Purpose: one list of an object's likely duplicates, to clean them up (spec 0049, AC-4907 to AC-4909).
// Main task: read each pair and its reason, then Merge it or mark it Not a duplicate (Undo in the toast).
// Leaves out: fuzzy matches, and pairs whose other record the reader can't see (absent, never locked). No Merge for
// a reader who can't change the object. Merge opens the merge dialog on the pair; once it lands the pair is gone.
import type { AttributeDefinition, DuplicatePair, DuplicatePairsList, MemberSummary, ObjectSummary } from '@crm/data';
import { pairKey } from '@crm/data';
import { useDuplicatePairs } from '@crm/data/react';
import { Button, Callout, EmptyState, Link, PageColumn, RecordChip, Table, TopBar } from '@crm/ui';
import { recordHref } from '../records/details.ts';
import { objectHref } from '../workspace/objects.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { focusTitle } from '../navigation/focus-title.ts';
import { useMergeDialog } from './merge/index.ts';
import { duplicatesHref } from './paths.ts';
import { strings } from './strings.ts';
import { useDismiss } from './useDismiss.ts';

/** Props for the Duplicates page. */
export interface DuplicatesScreenProps {
  readonly slug: string;
  readonly object: ObjectSummary;
  /** Narrowed to this record's pairs (from the record banner's Review), when set. */
  readonly recordId?: string;
  /** The pairs, from `data.records.duplicates.pairs`, made by the route for this visit. */
  readonly pairs: DuplicatePairsList;
  /** The object's attributes and the members, for the merge dialog's values. */
  readonly attributes: readonly AttributeDefinition[];
  readonly members: readonly MemberSummary[];
}

const COLUMNS = [
  { id: 'record', label: strings.columns.record, isRowHeader: true },
  { id: 'other', label: strings.columns.other },
  { id: 'reason', label: strings.columns.reason },
  { id: 'actions', label: strings.columns.actions, isLabelHidden: true, align: 'end' as const, size: 'fit' as const },
];

/** The page: every pair, 50 at a time, newest record first, with its states. */
export function DuplicatesScreen({ slug, object, recordId, pairs, attributes, members }: DuplicatesScreenProps) {
  const state = useDuplicatePairs(pairs);
  const dismiss = useDismiss(pairs);
  // Merge (AC-4907, AC-4910): the merge dialog on the pair; once it lands the merged record is gone, so the pairs
  // are read again and the pair drops out.
  const merging = useMergeDialog({
    slug,
    object,
    attributes,
    members,
    onMerged: () => {
      pairs.retry();
      focusTitle();
    },
    onCancel: focusTitle,
  });
  // Merge and Not a duplicate both need write on the object (AC-4909, AC-4919); the server checks the rest.
  const mayDismiss = object.access === 'write';
  const chip = (display: DuplicatePair['a']) => (
    <RecordChip
      display={display.name === '' ? { ...display, name: strings.unnamed } : display}
      href={recordHref(slug, object.apiSlug, display.recordId)}
    />
  );
  const topBar = (
    <TopBar
      title={strings.title(object.pluralName)}
      icon={object.icon}
      hue={object.hue}
      crumbs={[{ id: 'object', label: object.pluralName, href: objectHref(slug, object) }]}
    />
  );

  if (state.status === 'forbidden') {
    return (
      <WorkspacePage
        currentObject={object.apiSlug}
        page={{
          topBar,
          body: (
            <EmptyState tone="locked" title={strings.noAccess(object.pluralName)}>
              {strings.noAccessText}
            </EmptyState>
          ),
        }}
      />
    );
  }
  if (state.status === 'failed') {
    return (
      <WorkspacePage
        currentObject={object.apiSlug}
        page={{
          topBar,
          body: (
            <EmptyState tone="error" title={strings.failedTitle} onRetry={pairs.retry}>
              {strings.failedText}
            </EmptyState>
          ),
        }}
      />
    );
  }

  const empty =
    recordId === undefined ? (
      <EmptyState icon="copy" title={strings.emptyTitle(object.pluralName)}>
        {strings.emptyText}
      </EmptyState>
    ) : (
      <EmptyState
        icon="copy"
        title={strings.emptyRecord}
        actions={<Link href={duplicatesHref(slug, object.apiSlug)}>{strings.showAll}</Link>}
      />
    );

  const body = (
    <PageColumn>
      {recordId !== undefined && state.pairs.length > 0 && (
        <Callout actions={<Link href={duplicatesHref(slug, object.apiSlug)}>{strings.showAll}</Link>}>
          {strings.narrowed}
        </Callout>
      )}
      <Table
        label={strings.tableLabel}
        columns={mayDismiss ? COLUMNS : COLUMNS.filter((column) => column.id !== 'actions')}
        rows={state.pairs}
        getRowId={pairKey}
        isLoading={state.status === 'loading'}
        emptyState={empty}
        renderCell={(pair, columnId) => {
          if (columnId === 'record') return chip(pair.a);
          if (columnId === 'other') return chip(pair.b);
          if (columnId === 'reason') return strings.reason[pair.reason];
          return (
            <>
              {mayDismiss && (
                <Button
                  variant="secondary"
                  onPress={() => {
                    merging.open([pair.a.recordId, pair.b.recordId]);
                  }}
                >
                  {strings.merge}
                </Button>
              )}
              {mayDismiss && (
                <Button
                  variant="ghost"
                  onPress={() => {
                    dismiss(pair);
                  }}
                >
                  {strings.notDuplicate}
                </Button>
              )}
            </>
          );
        }}
      />
      {state.moreFailed && (
        <Callout tone="danger" isPolite actions={<Button onPress={pairs.more}>{strings.tryAgain}</Button>}>
          {strings.moreFailed}
        </Callout>
      )}
      {state.hasMore && !state.moreFailed && (
        <Button variant="secondary" isPending={state.isLoadingMore} onPress={pairs.more}>
          {strings.showMore}
        </Button>
      )}
    </PageColumn>
  );
  return (
    <>
      <WorkspacePage currentObject={object.apiSlug} page={{ topBar, body }} />
      {merging.dialog}
    </>
  );
}
