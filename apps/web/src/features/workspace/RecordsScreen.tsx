// Brief
// Purpose: one object's records (People in this loop) as a fast table, under the object's name and colour tile.
// Main task: read and edit people in place, add a person, and add a column, seeing others' changes live.
// Leaves out: filters, sorts, saved views, other objects' tables and presence (#6, #7, #20).
import {
  isEditableHere,
  toActorDisplays,
  toFieldAttribute,
  type AttributeDefinition,
  type MemberSummary,
  type ObjectSummary,
  type RecordsView,
  type RecordView,
} from '@crm/data';
import { useLiveStatus, useView } from '@crm/data/react';
import { Badge, Button, Callout, EmptyState, TopBar, ViewBar } from '@crm/ui';
import { columnWidthFor, DataGrid, type GridColumn } from '@crm/ui/grid';
import { useRouteContext, useRouter } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { AddAttributeDialog } from './AddAttributeDialog.tsx';
import { NewRecordDialog } from './NewRecordDialog.tsx';
import { strings } from './strings.ts';
import { useCan, WorkspacePage } from './WorkspacePage.tsx';

/** The one view this loop has ("All people"). */
const ALL = 'all';

/** Props for the records screen: what the object's route loaded through the data layer. */
export interface RecordsScreenProps {
  readonly slug: string;
  readonly object: ObjectSummary;
  readonly attributes: readonly AttributeDefinition[];
  readonly members: readonly MemberSummary[];
  readonly view: RecordsView;
}

/** The attributes the table shows, in order: every non system attribute by position, then the record's created at. */
function shownAttributes(attributes: readonly AttributeDefinition[]): readonly AttributeDefinition[] {
  const own = attributes.filter((attribute) => !attribute.isSystem).sort((a, b) => a.position - b.position);
  const createdAt = attributes.find((attribute) => attribute.isSystem && attribute.apiSlug === 'created_at');
  return createdAt === undefined ? own : [...own, createdAt];
}

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
export function RecordsScreen({ slug, object, attributes, members, view }: RecordsScreenProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const router = useRouter();
  const state = useView(view);
  // Paused only while the live connection is down; off (previews) shows nothing.
  const live = useLiveStatus(data.live);
  const [layout, setLayout] = useState<{ readonly columns: readonly GridColumn[]; readonly pinnedCount: number }>({
    columns: [],
    pinnedCount: 1,
  });
  const columns = useMemo(() => columnsFor(attributes, layout.columns), [attributes, layout.columns]);
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
            // The total count (AC-34), once it is known.
            {...(state.status === 'ready'
              ? {
                  meta: <Badge count={state.source.count} max={Infinity} label={object.pluralName.toLowerCase()} />,
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
              getDisplay={(_row, columnId) => (actorColumns.has(columnId) ? memberDisplays : undefined)}
              rowHeader={rowHeader}
              onColumnsChange={(next, pinnedCount) => {
                setLayout({ columns: next, pinnedCount });
              }}
              onCellChange={(change) => {
                data.records.setValue(slug, change);
              }}
              onCellsChange={(changes) => {
                data.records.setValues(slug, changes);
              }}
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
                const index = view.indexOf(record.id) ?? state.source.count - 1;
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
