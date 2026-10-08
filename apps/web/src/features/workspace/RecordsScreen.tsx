// Brief
// Purpose: one object's records (People in this loop) as a fast table, under the object's name and colour tile.
// Main task: read and edit people in place (a paste or clear is one change, undone with ⌘Z), sort a column, add a person and a column, live.
// Leaves out: filters, saved views and sorts that last past the visit, other objects' tables and presence (#7, #20).
import {
  isEditableHere,
  toActorDisplays,
  toFieldAttribute,
  type AttributeDefinition,
  type MemberSummary,
  type ObjectSummary,
  type RecordsView,
  type RecordView,
  type SortRule,
} from '@crm/data';
import { useLiveStatus, useView } from '@crm/data/react';
import { Badge, Button, Callout, EmptyState, TopBar, ViewBar } from '@crm/ui';
import { columnWidthFor, DataGrid, type GridColumn } from '@crm/ui/grid';
import { useRouteContext, useRouter } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { AddAttributeDialog } from './AddAttributeDialog.tsx';
import { queryOf, shownAttributes } from './columns.ts';
import { NewRecordDialog } from './NewRecordDialog.tsx';
import { strings } from './strings.ts';
import { editToast, isClear } from './undo.ts';
import { runUndo } from './useUndoShortcut.ts';
import { useCan, WorkspacePage } from './WorkspacePage.tsx';

/** The one view this loop has ("All people"). */
const ALL = 'all';

/** Props for the records screen: what the object's route loaded through the data layer. */
export interface RecordsScreenProps {
  readonly slug: string;
  readonly object: ObjectSummary;
  readonly attributes: readonly AttributeDefinition[];
  readonly members: readonly MemberSummary[];
  /** The view the loader warmed, in the table's opening order (`sort`). */
  readonly view: RecordsView;
  /** The opening order: newest first (spec 0006, AC-57). */
  readonly sort: SortRule | undefined;
}

/** A sort as one string, so a new object with the same sort is the same order. */
const sortKey = (sort: SortRule | undefined) => (sort === undefined ? '' : `${sort.attributeId}:${sort.direction}`);

/** Whether a record holds a column's value yet (a column just shown is read for the loaded rows first). */
const isCellKnown = (row: RecordView, columnId: string) => Object.hasOwn(row.values, columnId);

/**
 * The grid's columns: the ones the person laid out (order and widths), with
 * any new attribute at its type's width before Created at, where it sits
 * when nothing was moved.
 */
function columnsFor(attributes: readonly AttributeDefinition[], laidOut: readonly GridColumn[]): readonly GridColumn[] {
  const shown = shownAttributes(attributes);
  const fresh = shown.map((definition) => {
    const attribute = toFieldAttribute(definition, strings.referenceReadOnly);
    return { id: definition.id, attribute, width: columnWidthFor(attribute) };
  });
  if (laidOut.length === 0) return fresh;
  const byId = new Map(fresh.map((column) => [column.id, column]));
  const kept = laidOut.flatMap((column) => {
    const current = byId.get(column.id);
    return current === undefined ? [] : [{ ...column, attribute: current.attribute }];
  });
  const placed = new Set(kept.map((column) => column.id));
  const added = fresh.filter((column) => !placed.has(column.id));
  const createdAt = shown.find((definition) => definition.isSystem)?.id;
  const at = kept.findIndex((column) => column.id === createdAt);
  return at === -1 ? [...kept, ...added] : [...kept.slice(0, at), ...added, ...kept.slice(at)];
}

/** One object's page: the TopBar with New person, the ViewBar with Add attribute, and the table. */
export function RecordsScreen({ slug, object, attributes, members, view: warmed, sort: opening }: RecordsScreenProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const router = useRouter();
  // The column menu's sort, for this visit (spec 0006, AC-57): it replaces the order, and #20 saves it with a view.
  const [sort, setSort] = useState(opening);
  // The view for that sort: the warmed one until another sort's first rows are in, so the table never blanks.
  const [shown, setShown] = useState({ key: sortKey(opening), view: warmed });
  const wanted = sortKey(sort);
  const [layout, setLayout] = useState<{ readonly columns: readonly GridColumn[]; readonly pinnedCount: number }>({
    columns: [],
    pinnedCount: 1,
  });
  const columns = useMemo(() => columnsFor(attributes, layout.columns), [attributes, layout.columns]);
  // Only the columns on screen are read (spec 0006, AC-55); showing a hidden one reads it for the loaded rows.
  const visible = useMemo(
    () => columns.filter((column) => column.isHidden !== true).map((column) => column.id),
    [columns],
  );
  useEffect(() => {
    if (shown.key === wanted) return;
    let isCurrent = true;
    data.records.view(slug, object.id, queryOf(sort), visible).then(
      (next) => {
        if (isCurrent) setShown({ key: wanted, view: next });
      },
      () => {
        if (isCurrent) toasts.toast({ tone: 'danger', message: strings.somethingWrong });
      },
    );
    return () => {
      isCurrent = false;
    };
    // `visible` is read when the sort changes; a column shown later reaches the view through useView.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, shown.key, data, slug, object.id]);
  const view = shown.view;
  const state = useView(view, visible);
  // Paused only while the live connection is down; off (previews) shows nothing.
  const live = useLiveStatus(data.live);
  const memberDisplays = useMemo(() => toActorDisplays(members), [members]);
  const actorColumns = useMemo(
    () => new Set(attributes.filter((attribute) => attribute.type === 'actor_reference').map((each) => each.id)),
    [attributes],
  );
  const [isCreating, setCreating] = useState(false);
  const [isAdding, setAdding] = useState(false);
  // Only owners and admins change the schema (spec 0009, AC-136); the server refuses anyone else on its own.
  const canChangeSchema = useCan('schema.manage');
  const [focusRow, setFocusRow] = useState<{ readonly index: number } | undefined>(undefined);
  const nameAttribute = attributes.find((attribute) => attribute.id === object.primaryAttributeId);
  const emailAttribute = attributes.find(
    (attribute) => attribute.type === 'email' && attribute.apiSlug === 'email_addresses',
  );
  const editors = [nameAttribute, emailAttribute].filter(
    (attribute): attribute is AttributeDefinition => attribute !== undefined && isEditableHere(attribute),
  );
  const rowHeader = object.primaryAttributeId ?? columns[0]?.id ?? '';
  const newRecord = strings.newRecord(object.singularName);

  const openCreate = () => {
    setCreating(true);
  };

  return (
    <WorkspacePage
      currentObject={object.apiSlug}
      page={{
        topBar: (
          <TopBar
            title={object.pluralName}
            icon={object.icon}
            hue={object.hue}
            // The total count (AC-34), once it is known: "10,000+" past a filtered view's cap (spec 0006, AC-53).
            {...(state.status === 'ready'
              ? {
                  meta: (
                    <Badge
                      count={state.count.atLeast ? state.count.count + 1 : state.count.count}
                      max={state.count.atLeast ? state.count.count : Infinity}
                      label={object.pluralName.toLowerCase()}
                    />
                  ),
                }
              : {})}
          >
            {/* Only where the person may change records (spec 0009, AC-142); the server refuses anyone else. */}
            {object.access === 'write' && (
              <Button variant="primary" icon="plus" onPress={openCreate}>
                {newRecord}
              </Button>
            )}
          </TopBar>
        ),
        viewBar: (
          <ViewBar
            views={[{ id: ALL, name: strings.allRecords(object.pluralName) }]}
            currentViewId={ALL}
            onViewChange={() => undefined}
          >
            {canChangeSchema && (
              <Button icon="plus" onPress={() => setAdding(true)}>
                {strings.addAttribute}
              </Button>
            )}
          </ViewBar>
        ),
        body: (
          <>
            {live === 'paused' && (
              <Callout placement="banner" isAnnounced>
                {strings.livePaused}
              </Callout>
            )}
            <DataGrid<RecordView>
              label={object.pluralName}
              columns={columns}
              pinnedCount={layout.pinnedCount}
              rows={state.source}
              getValue={(row, columnId) => row.values[columnId] ?? null}
              isCellKnown={isCellKnown}
              rowNotes={state.rowNotes}
              onEditingChange={view.holdSettle}
              onSort={(columnId, direction) => {
                setSort({ attributeId: columnId, direction });
              }}
              getDisplay={(_row, columnId) => (actorColumns.has(columnId) ? memberDisplays : undefined)}
              rowHeader={rowHeader}
              onColumnsChange={(next, pinnedCount) => {
                setLayout({ columns: next, pinnedCount });
              }}
              onCellChange={(change) => {
                data.records.setValue(slug, change);
              }}
              onCellsChange={(changes) => {
                // One action, one write (spec 0006, AC-50); a paste or clear of several cells says so, with Undo.
                const kind =
                  changes.length === 1 ? 'cell' : isClear(changes.map((change) => change.value)) ? 'clear' : 'paste';
                data.records.setValues(slug, changes, kind).then(
                  (outcome) => {
                    const toast = editToast(outcome, kind, (undoId) => {
                      runUndo(data, toasts, slug, undoId);
                    });
                    if (toast !== undefined) toasts.toast(toast);
                  },
                  // The records layer failed to load; the edit never showed.
                  () => {
                    toasts.toast({ tone: 'danger', message: strings.somethingWrong });
                  },
                );
              }}
              // The screen confirms a paste once its write lands, with Undo (spec 0006).
              confirmsPaste={false}
              cellErrors={state.cellErrors}
              status={state.status}
              onRetry={view.retry}
              members={memberDisplays}
              emptyState={
                <EmptyState
                  title={strings.emptyTitle(object.pluralName)}
                  icon={object.icon}
                  // The top bar's New person is the one primary on the page.
                  {...(object.access === 'write'
                    ? {
                        actions: (
                          <Button icon="plus" onPress={openCreate}>
                            {newRecord}
                          </Button>
                        ),
                      }
                    : {})}
                >
                  {strings.emptyText(object.pluralName)}
                </EmptyState>
              }
              {...(focusRow === undefined ? {} : { focusRow })}
            />
            <NewRecordDialog
              isOpen={isCreating}
              onOpenChange={setCreating}
              title={newRecord}
              editors={editors}
              newId={data.records.newId}
              onCreate={(id, values) => data.records.create(slug, object.id, id, values)}
              singularName={object.singularName}
              onCreated={(record) => {
                setCreating(false);
                // A record made here sits first (spec 0006, AC-56).
                const index = view.indexOf(record.id) ?? 0;
                setFocusRow({ index });
              }}
            />
            <AddAttributeDialog
              isOpen={isAdding}
              onOpenChange={setAdding}
              onAdd={(input) => data.attributes.create(slug, { objectId: object.id, ...input })}
              onAdded={(attribute) => {
                setAdding(false);
                toasts.toast({ tone: 'success', message: strings.attributeAdded(attribute.title) });
                void router.invalidate();
              }}
            />
          </>
        ),
      }}
    />
  );
}
