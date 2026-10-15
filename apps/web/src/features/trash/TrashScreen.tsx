// Brief
// Purpose: the workspace's trash: every record deleted in the last 30 days that the person may see, newest first.
// Main task: find a record deleted by mistake and restore it (several at once), seeing why one can't come back.
// Leaves out: opening or editing trashed records, delete forever and empty trash (milestone 4), more than 500 at once.
import { TRASH_NAME_COLUMN, type MemberSummary, type ObjectSummary, type TrashView } from '@crm/data';
import { useTrash } from '@crm/data/react';
import { Badge, BulkActionBar, Button, Callout, EmptyState, Select, Toolbar, TopBar } from '@crm/ui';
import { columnWidthFor, DataGrid, noRows, selectedCount, type GridColumn, type GridSelection } from '@crm/ui/grid';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { strings } from './strings.ts';
import { canRestore, cellValue, deletedBy, restoreToast, TRASH_ATTRIBUTES, TRASH_COLUMNS } from './trash.ts';

/** Props for the Trash screen: what its route loaded through the data layer. */
export interface TrashScreenProps {
  readonly slug: string;
  /** Every object the person may see, archived ones too (for the filter and the Object column). */
  readonly objects: readonly ObjectSummary[];
  readonly members: readonly MemberSummary[];
  /** The trash of the object in the filter, or of every object. */
  readonly view: TrashView;
  /** The object the list is narrowed to (`?object=`), or undefined for all. */
  readonly objectId: string | undefined;
}

/** The value meaning "every object" in the filter. */
const ALL = 'all';

/** A text column's width: the narrower tiers (a time, a day) cut their header short beside its read only lock. */
const objectColumn = TRASH_ATTRIBUTES.find((attribute) => attribute.id === TRASH_COLUMNS.object);
const TEXT_WIDTH = objectColumn === undefined ? 0 : columnWidthFor(objectColumn);

const COLUMNS: readonly GridColumn[] = TRASH_ATTRIBUTES.map((attribute) => ({
  id: attribute.id,
  attribute,
  width: Math.max(columnWidthFor(attribute), TEXT_WIDTH),
}));

/** The trash: TopBar with the count, the object filter, the read only grid, and Restore in the bulk bar. */
export function TrashScreen({ slug, objects, members, view, objectId }: TrashScreenProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const state = useTrash(view);
  const byId = useMemo(() => new Map(objects.map((object) => [object.id, object])), [objects]);
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  // The rows ticked, for this view only: another object filter starts with none.
  const [held, setHeld] = useState<{ readonly view: TrashView; readonly selection: GridSelection }>(() => ({
    view,
    selection: noRows(),
  }));
  const selection = held.view === view ? held.selection : noRows();
  const clear = () => {
    setHeld({ view, selection: noRows() });
  };
  const [focusRow, setFocusRow] = useState<{ readonly index: number } | undefined>(undefined);
  const count = selectedCount(selection, state.count.count);
  const ids = selection.kind === 'some' ? [...selection.ids] : [];
  const filtered = objectId === undefined ? undefined : byId.get(objectId);

  const restore = () => {
    const [only] = ids.length === 1 ? ids : [];
    const onlyName = only === undefined ? undefined : view.row(only)?.item.display.name;
    // The grid takes focus back where the first restored row was, so the keyboard carries on there.
    const rows = ids.flatMap((id) => {
      const at = view.indexOf(id);
      return at === undefined ? [] : [at];
    });
    setFocusRow({ index: Math.max(0, Math.min(...rows, state.source.count - 1 - ids.length)) });
    clear();
    data.trash.restore(slug, ids).then(
      (summary) => {
        const toast = restoreToast(summary, onlyName);
        if (toast !== undefined) toasts.toast(toast);
      },
      () => {
        toasts.toast({ tone: 'danger', message: strings.somethingWrong });
      },
    );
  };

  const isAllowed = canRestore(
    ids.map((id) => view.row(id)),
    byId,
  );
  return (
    <WorkspacePage
      currentPage="trash"
      page={{
        topBar: (
          <TopBar
            title={strings.title}
            icon="trash"
            {...(state.status === 'ready'
              ? {
                  meta: (
                    <Badge
                      count={state.count.count}
                      max={Infinity}
                      isAtLeast={state.count.atLeast}
                      label={strings.countLabel}
                    />
                  ),
                }
              : {})}
          />
        ),
        viewBar: (
          <Toolbar label={strings.filterLabel}>
            <Select
              label={strings.objectFilter}
              isLabelHidden
              size="sm"
              items={[
                { id: ALL, label: strings.allObjects },
                ...objects.map((object) => ({
                  id: object.id,
                  label: object.isArchived ? strings.archived(object.pluralName) : object.pluralName,
                  icon: object.icon,
                  hue: object.hue,
                })),
              ]}
              value={objectId ?? ALL}
              onChange={(id) => {
                void navigate({
                  to: '/w/$slug/trash',
                  params: { slug },
                  search: id === null || id === ALL ? {} : { object: id },
                });
              }}
            />
          </Toolbar>
        ),
        body: (
          <>
            <DataGrid
              label={strings.title}
              columns={COLUMNS}
              pinnedCount={1}
              rows={state.source}
              getValue={(row, columnId) => cellValue(row, columnId, byId, timeZone)}
              getDisplay={(row, columnId) => {
                if (columnId === TRASH_COLUMNS.name) return row.item.display;
                if (columnId === TRASH_COLUMNS.deletedBy) return [deletedBy(row, members)];
                return undefined;
              }}
              rowHeader={TRASH_NAME_COLUMN}
              selection={selection}
              onSelectionChange={(next) => {
                setHeld({ view, selection: next });
              }}
              cellErrors={state.cellErrors}
              status={state.status}
              onRetry={view.retry}
              {...(state.error === undefined ? {} : { errorText: state.error.message })}
              emptyState={
                filtered === undefined ? (
                  <EmptyState title={strings.emptyTitle} icon="trash">
                    {strings.emptyText}
                  </EmptyState>
                ) : (
                  <EmptyState title={strings.emptyObject(filtered.pluralName)} icon={filtered.icon}>
                    {strings.emptyObjectText}
                  </EmptyState>
                )
              }
              {...(focusRow === undefined ? {} : { focusRow })}
            />
            {count > 0 && (
              <BulkActionBar placement="floating" count={count} total={state.count.count} onClear={clear}>
                {count > 500 ? (
                  <Callout placement="bar">{strings.tooMany}</Callout>
                ) : (
                  <>
                    <Button icon="archive-restore" isDisabled={!isAllowed} onPress={restore}>
                      {strings.restore}
                    </Button>
                    {!isAllowed && <Callout placement="bar">{strings.cannotRestore}</Callout>}
                  </>
                )}
              </BulkActionBar>
            )}
          </>
        ),
      }}
    />
  );
}
