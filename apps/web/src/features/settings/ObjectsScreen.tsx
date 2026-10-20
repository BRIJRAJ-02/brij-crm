// Brief
// Purpose: Settings, Objects: every object, standard and custom, in the workspace's order, and the archived ones.
// Main task: owners and admins create, reorder (drag, or Move up and down), archive and restore objects, or open one.
// Leaves out: an object's attributes and names (its own page), the schema map (#56) and usage beyond the meter.
import { isDataError, type ObjectSummary, type Usage } from '@crm/data';
import {
  Badge,
  Button,
  Callout,
  Disclosure,
  EmptyState,
  Icon,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Meter,
  Skeleton,
  Spinner,
  Table,
  type TableColumn,
} from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { focusTitle } from '../navigation/focus-title.ts';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { ArchiveObjectDialog } from './ArchiveObjectDialog.tsx';
import { byPosition, objectSettingsHref } from './nav.ts';
import { NewObjectDialog } from './NewObjectDialog.tsx';
import { SettingsPage } from './SettingsPage.tsx';
import { strings } from './strings.ts';

/** Props for Settings, Objects: what its route loaded through the data layer. */
export interface ObjectsScreenProps {
  readonly slug: string;
  /** Every object the person can see, archived ones too. */
  readonly objects: readonly ObjectSummary[];
  readonly usage: Usage;
}

const COLUMNS: readonly TableColumn[] = [
  { id: 'object', label: strings.objectColumn, isRowHeader: true, isInline: true },
  { id: 'kind', label: strings.kindColumn },
  { id: 'attributes', label: strings.attributesColumn, align: 'end' },
  { id: 'actions', label: strings.actionsColumn, isLabelHidden: true, align: 'end' },
];

const number = (value: number) => new Intl.NumberFormat().format(value);

/** The server's words for a failure, or the plain fallback. */
const why = (error: unknown) => (isDataError(error) ? error.message : strings.somethingWrong);

/** An object's tile and plural name, as the sidebar shows it. */
function ObjectName({ object }: { readonly object: ObjectSummary }) {
  return (
    <>
      <Icon name={object.icon} tile={object.hue} />
      {object.pluralName}
    </>
  );
}

/** Settings, Objects: the meter, the live objects in order, and the Archived section. */
export function ObjectsScreen({ slug, objects, usage }: ObjectsScreenProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  // Only owners and admins change the schema (spec 0009, AC-136); the server refuses anyone else on its own.
  const canManage = useCan('schema.manage');
  const { all, live, archived } = useMemo(() => byPosition(objects), [objects]);
  const [isCreating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState<ObjectSummary | undefined>(undefined);
  const [restoring, setRestoring] = useState<string | undefined>(undefined);
  const [isMoving, setMoving] = useState(false);

  const open = (object: ObjectSummary) => {
    void navigate({ href: objectSettingsHref(slug, object) });
  };

  /** Moves an object to `index` among every object (archived ones keep their places); server confirmed. */
  const moveTo = (object: ObjectSummary, index: number) => {
    if (isMoving || index === all.indexOf(object)) return;
    setMoving(true);
    data.objects.reorder(slug, object.id, index).then(
      (next) => {
        setMoving(false);
        const order = next.filter((each) => !each.isArchived);
        const place = order.findIndex((each) => each.id === object.id) + 1;
        toasts.toast({ tone: 'success', message: strings.moved(object.pluralName, place, order.length) });
      },
      (error: unknown) => {
        setMoving(false);
        toasts.toast({ tone: 'danger', message: strings.moveFailed(object.pluralName, why(error)) });
      },
    );
  };

  /** Move up or down past the next live object, which is where the row visibly goes. */
  const step = (object: ObjectSummary, direction: -1 | 1) => {
    const neighbour = live[live.indexOf(object) + direction];
    if (neighbour !== undefined) moveTo(object, all.indexOf(neighbour));
  };

  const restore = (object: ObjectSummary) => {
    if (restoring !== undefined) return;
    setRestoring(object.id);
    data.objects.restore(slug, object.id).then(
      () => {
        setRestoring(undefined);
        toasts.toast({ tone: 'success', message: strings.restoredToast(object.pluralName) });
        focusTitle();
      },
      (error: unknown) => {
        setRestoring(undefined);
        toasts.toast({ tone: 'danger', message: strings.restoreFailed(object.pluralName, why(error)) });
      },
    );
  };

  const attributeCount = (object: ObjectSummary) => {
    const used = usage.attributes[object.id]?.used;
    return used === undefined ? <Skeleton width="short" /> : strings.attributeCount(used, number(used));
  };

  const liveCell = (object: ObjectSummary, column: string) => {
    switch (column) {
      case 'object':
        return <ObjectName object={object} />;
      case 'kind':
        return <Badge text={object.isStandard ? strings.standard : strings.custom} />;
      case 'attributes':
        return attributeCount(object);
      default: {
        const at = live.indexOf(object);
        return (
          <MenuTrigger>
            <Button variant="ghost" icon="ellipsis" label={strings.rowActions(object.pluralName)} />
            <Menu
              label={strings.rowActions(object.pluralName)}
              onAction={(key) => {
                if (key === 'open') open(object);
                if (key === 'up') step(object, -1);
                if (key === 'down') step(object, 1);
                if (key === 'archive') setArchiving(object);
              }}
            >
              <MenuItem id="open" icon="arrow-right">
                {strings.open}
              </MenuItem>
              {canManage && (
                <>
                  <MenuItem id="up" icon="chevron-up" isDisabled={at <= 0 || isMoving}>
                    {strings.moveUp}
                  </MenuItem>
                  <MenuItem id="down" icon="chevron-down" isDisabled={at >= live.length - 1 || isMoving}>
                    {strings.moveDown}
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem id="archive" icon="archive" isDanger>
                    {strings.archive}
                  </MenuItem>
                </>
              )}
            </Menu>
          </MenuTrigger>
        );
      }
    }
  };

  const archivedCell = (object: ObjectSummary, column: string) => {
    switch (column) {
      case 'object':
        return <ObjectName object={object} />;
      case 'kind':
        return <Badge text={object.isStandard ? strings.standard : strings.custom} />;
      case 'attributes':
        return attributeCount(object);
      default:
        return canManage ? (
          <Button
            variant="ghost"
            icon="archive-restore"
            isPending={restoring === object.id}
            onPress={() => {
              restore(object);
            }}
          >
            {restoring === object.id ? strings.restoring : strings.restore}
          </Button>
        ) : null;
    }
  };

  // The live objects' table: the same for everyone, with handles only for those who may move them.
  const liveTable = {
    label: strings.objects,
    columns: COLUMNS,
    rows: live,
    getRowId: (object: ObjectSummary) => object.id,
    renderCell: liveCell,
    onRowAction: (id: string) => {
      const object = live.find((each) => each.id === id);
      if (object !== undefined) open(object);
    },
    emptyState: (
      <EmptyState title={strings.noLiveObjects}>
        {canManage ? strings.noLiveObjectsText : strings.noLiveObjectsMemberText}
      </EmptyState>
    ),
  };
  const meter = usage.customObjects;
  return (
    <SettingsPage
      title={strings.objects}
      description={strings.objectsDescription}
      {...(canManage
        ? {
            actions: (
              <>
                {/* A move waits for the server (definition writes are never optimistic): say it is under way. */}
                {isMoving && <Spinner label={strings.moving} />}
                <Button variant="primary" icon="plus" onPress={() => setCreating(true)}>
                  {strings.newObject}
                </Button>
              </>
            ),
          }
        : {})}
    >
      {canManage && meter !== undefined && (
        <Meter label={strings.customObjects} value={meter.used} maxValue={meter.limit} />
      )}
      {!canManage && <Callout>{strings.readOnlyNote}</Callout>}
      {canManage ? (
        <Table
          {...liveTable}
          getRowLabel={(object) => object.pluralName}
          onReorder={(id, targetId, position) => {
            const object = all.find((each) => each.id === id);
            const target = all.find((each) => each.id === targetId);
            if (object === undefined || target === undefined) return;
            const rest = all.filter((each) => each.id !== id);
            moveTo(object, rest.indexOf(target) + (position === 'after' ? 1 : 0));
          }}
        />
      ) : (
        <Table {...liveTable} />
      )}
      <Disclosure title={strings.archived} count={archived.length}>
        {archived.length === 0 ? (
          <EmptyState title={strings.noArchived}>{strings.noArchivedText}</EmptyState>
        ) : (
          <Table
            label={strings.archivedObjects}
            columns={COLUMNS}
            rows={archived}
            getRowId={(object) => object.id}
            renderCell={archivedCell}
            onRowAction={(id) => {
              const object = archived.find((each) => each.id === id);
              if (object !== undefined) open(object);
            }}
          />
        )}
      </Disclosure>
      <NewObjectDialog
        isOpen={isCreating}
        onOpenChange={setCreating}
        objects={objects}
        newId={data.objects.newId}
        onCreate={(input) => data.objects.create(slug, input)}
        onCreated={(object) => {
          setCreating(false);
          toasts.toast({ tone: 'success', message: strings.created(object.pluralName) });
          open(object);
        }}
      />
      <ArchiveObjectDialog
        data={data}
        slug={slug}
        object={archiving}
        onClose={() => setArchiving(undefined)}
        onArchived={(object) => {
          setArchiving(undefined);
          toasts.toast({ tone: 'success', message: strings.archivedToast(object.pluralName) });
          // Its row left the live table, and the menu that opened the confirm with it.
          focusTitle();
        }}
      />
    </SettingsPage>
  );
}

/** Settings, Objects while it loads: the header, a meter's place and skeleton rows (AC-247). */
export function ObjectsPending() {
  // The meter's place only for those who get a meter, so nothing moves when the page arrives.
  const canManage = useCan('schema.manage');
  return (
    <SettingsPage title={strings.objects} description={strings.objectsDescription}>
      {canManage && <Skeleton width="long" />}
      <Table
        label={strings.objects}
        columns={COLUMNS}
        rows={[]}
        getRowId={() => ''}
        renderCell={() => null}
        isLoading
      />
    </SettingsPage>
  );
}
