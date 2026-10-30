// Brief
// Purpose: Settings › Lists (spec 0048, AC-4828): every list the member may read, and the archived ones apart.
// Main task: open a list's settings, make a list, archive or restore one of your own (any, for owners and admins).
// Leaves out: a list's name, look and fields (its own settings page), and entries (the list's page).
import { isDataError, type DataLayer, type ListView, type MemberSummary, type ObjectSummary } from '@crm/data';
import {
  Badge,
  Button,
  Disclosure,
  EmptyState,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Skeleton,
  Table,
  type TableColumn,
  type Toasts,
} from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { Suspense, useState } from 'react';
import { ArchiveListDialog } from '../lists/ArchiveListDialog.tsx';
import { LazyNewListModal } from '../lists/LazyNewListModal.tsx';
import { listHref } from '../lists/paths.ts';
import { strings as listStrings } from '../lists/strings.ts';
import { focusTitle } from '../navigation/focus-title.ts';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { listSettingsHref } from './nav.ts';
import { SettingsPage } from './SettingsPage.tsx';

/** Props for Settings › Lists: what its route loaded through the data layer. */
export interface ListsScreenProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly slug: string;
  /** Every list the member may read, archived ones too. */
  readonly lists: readonly ListView[];
  readonly objects: readonly ObjectSummary[];
  readonly members: readonly MemberSummary[];
}

/** The count column shows for owners and admins only (decision 13): the server sends the number to no one else. */
const columns = (hasCount: boolean): readonly TableColumn[] => [
  { id: 'name', label: listStrings.nameColumn, isRowHeader: true, isInline: true },
  { id: 'object', label: listStrings.objectColumn },
  { id: 'createdBy', label: listStrings.createdByColumn },
  ...(hasCount ? [{ id: 'entries', label: listStrings.entriesColumn, align: 'end' as const }] : []),
  { id: 'actions', label: listStrings.actionsColumn, isLabelHidden: true, align: 'end' as const },
];

/** Settings › Lists. */
export function ListsScreen({ data, toasts, slug, lists, objects, members }: ListsScreenProps) {
  const navigate = useNavigate();
  const canMake = useCan('lists.manage');
  const [isMaking, setMaking] = useState(false);
  const [hasMade, setHasMade] = useState(false);
  const [archiving, setArchiving] = useState<ListView | undefined>(undefined);
  const [restoring, setRestoring] = useState<string | undefined>(undefined);
  const live = lists.filter((list) => !list.isArchived);
  const archived = lists.filter((list) => list.isArchived);
  const hasCount = lists.some((list) => list.entryCount !== undefined);
  const objectOf = (list: ListView) => objects.find((each) => each.id === list.objectId);
  const makerOf = (list: ListView) => members.find((member) => member.id === list.createdByMemberId)?.name;

  const restore = (list: ListView) => {
    if (restoring !== undefined) return;
    setRestoring(list.id);
    data.lists.restore(slug, list.id).then(
      () => {
        setRestoring(undefined);
        toasts.toast({ tone: 'success', message: listStrings.restoredToast(list.name) });
      },
      (error: unknown) => {
        setRestoring(undefined);
        toasts.toast({
          tone: 'danger',
          message: isDataError(error) ? error.message : listStrings.restoreFailed,
        });
      },
    );
  };

  const cell = (list: ListView, column: string) => {
    switch (column) {
      case 'name':
        return list.name;
      case 'object':
        return <Badge text={objectOf(list)?.pluralName ?? ''} />;
      case 'createdBy':
        return makerOf(list) ?? '';
      case 'entries':
        return list.entryCount === undefined ? '' : list.entryCount.toLocaleString('en');
      default:
        if (list.isArchived) {
          return list.canManage ? (
            <Button
              variant="ghost"
              icon="archive-restore"
              isPending={restoring === list.id}
              onPress={() => {
                restore(list);
              }}
            >
              {listStrings.restore}
            </Button>
          ) : null;
        }
        return (
          <MenuTrigger>
            <Button variant="ghost" icon="ellipsis" label={listStrings.entryActions(list.name)} />
            <Menu
              label={listStrings.entryActions(list.name)}
              onAction={(key) => {
                if (key === 'open') void navigate({ href: listHref(slug, list) });
                if (key === 'archive') setArchiving(list);
              }}
            >
              <MenuItem id="open" icon="arrow-right">
                {listStrings.openList}
              </MenuItem>
              {list.canManage && (
                <>
                  <MenuSeparator />
                  <MenuItem id="archive" icon="archive" isDanger>
                    {listStrings.archive}
                  </MenuItem>
                </>
              )}
            </Menu>
          </MenuTrigger>
        );
    }
  };

  const open = (id: string) => {
    const list = lists.find((each) => each.id === id);
    if (list !== undefined) void navigate({ href: listSettingsHref(slug, list) });
  };

  return (
    <SettingsPage
      title={listStrings.settingsTitle}
      {...(canMake
        ? {
            actions: (
              <Button
                variant="primary"
                icon="plus"
                onPress={() => {
                  setHasMade(true);
                  setMaking(true);
                }}
              >
                {listStrings.newList}
              </Button>
            ),
          }
        : {})}
    >
      <Table
        label={listStrings.settingsTitle}
        columns={columns(hasCount)}
        rows={live}
        getRowId={(list) => list.id}
        renderCell={cell}
        isScrollable
        onRowAction={open}
        emptyState={<EmptyState icon="list" title={listStrings.settingsEmpty} />}
      />
      {archived.length > 0 && (
        <Disclosure title={listStrings.archivedSection} count={archived.length}>
          <Table
            label={listStrings.archivedSection}
            columns={columns(hasCount)}
            rows={archived}
            getRowId={(list) => list.id}
            renderCell={cell}
            onRowAction={open}
          />
        </Disclosure>
      )}
      {hasMade && (
        <Suspense fallback={null}>
          <LazyNewListModal
            data={data}
            slug={slug}
            isOpen={isMaking}
            objects={objects.filter((object) => !object.isArchived && object.access === 'write')}
            onClose={() => {
              setMaking(false);
            }}
            onMade={(list) => {
              setMaking(false);
              toasts.toast({ tone: 'success', message: listStrings.listMade(list.name) });
              void navigate({ href: listHref(slug, list) });
            }}
          />
        </Suspense>
      )}
      <ArchiveListDialog
        data={data}
        slug={slug}
        list={archiving}
        onClose={() => {
          setArchiving(undefined);
        }}
        onArchived={(list) => {
          setArchiving(undefined);
          // Undo restores it through the same call as the Archived section's Restore.
          toasts.toast({
            tone: 'success',
            message: listStrings.archivedToast(list.name),
            action: {
              label: listStrings.undo,
              onAction: () => {
                restore(list);
              },
            },
          });
          focusTitle();
        }}
      />
    </SettingsPage>
  );
}

/** Settings › Lists while it loads: skeleton rows where the table's go. */
export function ListsPending() {
  return (
    <SettingsPage title={listStrings.settingsTitle}>
      <Skeleton lines={4} />
    </SettingsPage>
  );
}
