// Brief
// Purpose: one object's records (People in this loop) as a fast table, under the object's name and colour tile.
// Main task: read and edit people in place, add a person, and add a column.
// Leaves out: filters, sorts, saved views, other objects' tables and live updates (#6, #7, #20).
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
import { useView } from '@crm/data/react';
import { Button, EmptyState, TopBar, ViewBar } from '@crm/ui';
import { columnWidthFor, DataGrid, type GridColumn } from '@crm/ui/grid';
import { useRouteContext, useRouter } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { AddAttributeDialog } from './AddAttributeDialog.tsx';
import { NewRecordDialog } from './NewRecordDialog.tsx';
import { strings } from './strings.ts';
import { WorkspacePage } from './WorkspacePage.tsx';

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

/** The grid's columns: the ones the person laid out first (order and widths), then any new attribute at its type's width. */
function columnsFor(attributes: readonly AttributeDefinition[], laidOut: readonly GridColumn[]): readonly GridColumn[] {
  const fresh = shownAttributes(attributes).map((definition) => {
    const attribute = toFieldAttribute(definition, strings.referenceReadOnly);
    return { id: definition.id, attribute, width: columnWidthFor(attribute) };
  });
  const byId = new Map(fresh.map((column) => [column.id, column]));
  const kept = laidOut.flatMap((column) => {
    const current = byId.get(column.id);
    return current === undefined ? [] : [{ ...column, attribute: current.attribute }];
  });
  const placed = new Set(kept.map((column) => column.id));
  return [...kept, ...fresh.filter((column) => !placed.has(column.id))];
}

/** One object's page: the TopBar with New person, the ViewBar with Add attribute, and the table. */
export function RecordsScreen({ slug, object, attributes, members, view }: RecordsScreenProps) {
  const { data } = useRouteContext({ from: '__root__' });
  const router = useRouter();
  const state = useView(view);
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
          <TopBar title={object.pluralName} icon={object.icon} hue={object.hue}>
            <Button variant="primary" icon="plus" onPress={openCreate}>
              {newRecord}
            </Button>
          </TopBar>
        ),
        viewBar: (
          <ViewBar
            views={[{ id: ALL, name: strings.allRecords(object.pluralName) }]}
            currentViewId={ALL}
            onViewChange={() => undefined}
          >
            <Button icon="plus" onPress={() => setAdding(true)}>
              {strings.addAttribute}
            </Button>
          </ViewBar>
        ),
        body: (
          <>
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
                  actions={
                    <Button variant="primary" icon="plus" onPress={openCreate}>
                      {newRecord}
                    </Button>
                  }
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
              onCreate={(values) => data.records.create(slug, object.id, values)}
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
              onAdded={() => {
                setAdding(false);
                void router.invalidate();
              }}
            />
          </>
        ),
      }}
    />
  );
}
