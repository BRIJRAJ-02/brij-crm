// Brief
// Purpose: one place's page (spec 0065, AC-6508, AC-6509): its hours, special days and details, then its tables and
// areas as plain lists, the base for Menu QR's codes and Table seating's online fitting.
// Main task: add many tables at once ("T1 to T10, seats 2 to 4"), drag them into order, and say which go online.
// Leaves out: a floor plan canvas (later), reservations and holds (Table seating, H3), and codes (Menu QR, H2).
import type { Area, DiningTable, HospitalityStore, Place, PlaceFloor } from '@crm/data';
import { useHospitality } from '@crm/data/react';
import { HOSPITALITY_LIMITS, tableLabels } from '@crm/data/hospitality';
import {
  BulkActionBar,
  Button,
  Disclosure,
  EmptyState,
  Field,
  FormRow,
  Form,
  LockReason,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Modal,
  Select,
  SettingsSection,
  Switch,
  Table,
  VisuallyHidden,
  type FormRefusal,
  type TableColumn,
  type Toasts,
} from '@crm/ui';
import { useId, useMemo, useState } from 'react';
import { businessSettingsHref } from '../settings/nav.ts';
import { formRefusals } from '../settings/refusals.ts';
import { SettingsPage } from '../settings/SettingsPage.tsx';
import { PlaceSections } from './PlaceSections.tsx';
import { strings } from './strings.ts';

/** Props for a place's tables. */
export interface FloorScreenProps {
  readonly store: HospitalityStore;
  readonly slug: string;
  readonly place: Place;
  readonly toasts: Toasts;
}

const TABLE_COLUMNS: readonly TableColumn[] = [
  { id: 'label', label: strings.label, isRowHeader: true },
  { id: 'area', label: strings.area },
  { id: 'seats', label: strings.seats, align: 'end', size: 'fit' },
  { id: 'joins', label: strings.joins, size: 'fill' },
  { id: 'online', label: strings.online, size: 'fit' },
  { id: 'actions', label: strings.actions, isLabelHidden: true, align: 'end', size: 'fit', showsOnHover: true },
];

const AREA_COLUMNS: readonly TableColumn[] = [
  { id: 'name', label: strings.areaName, isRowHeader: true, size: 'fill' },
  { id: 'tables', label: strings.tables, align: 'end', size: 'fit' },
  { id: 'actions', label: strings.actions, isLabelHidden: true, align: 'end', size: 'fit', showsOnHover: true },
];

/** What a dialog is open for. */
type Editing =
  | { readonly kind: 'add' }
  | { readonly kind: 'table'; readonly table: DiningTable }
  | { readonly kind: 'area'; readonly area?: Area }
  | { readonly kind: 'delete'; readonly table: DiningTable }
  | { readonly kind: 'delete-area'; readonly area: Area };

/** One place's areas and tables. */
export function FloorScreen({ store, slug, place, toasts }: FloorScreenProps) {
  const state = useHospitality(store.floor(slug, place.id));
  // The place as Business holds it, so its name, hours and details follow every save here at once.
  const business = useHospitality(store.business(slug));
  const shown =
    business.status === 'ready' ? (business.value.places.find((each) => each.id === place.id) ?? place) : place;
  const [editing, setEditing] = useState<Editing | undefined>(undefined);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const limitId = useId();
  const floor = state.status === 'ready' ? state.value : undefined;
  // One list per answer, so the tables never see new rows when nothing changed.
  const live = useMemo(() => floor?.tables.filter((table) => !table.archived) ?? [], [floor]);
  const archived = useMemo(() => floor?.tables.filter((table) => table.archived) ?? [], [floor]);
  const labels = useMemo(() => new Map(floor?.tables.map((table) => [table.id, table.label]) ?? []), [floor]);
  const areaNames = useMemo(() => new Map(floor?.areas.map((area) => [area.id, area.name]) ?? []), [floor]);
  const isFull = live.length >= HOSPITALITY_LIMITS.tablesPerPlace;
  const ticked = live.filter((table) => selected.has(table.id));
  const said = (refused: { readonly message: string } | undefined) => {
    if (refused !== undefined) toasts.toast({ tone: 'danger', message: refused.message });
  };
  const archive = (table: DiningTable) => {
    void store.archiveTable(slug, place.id, table.id).then((refused) => {
      if (refused !== undefined) {
        said(refused);
        return;
      }
      toasts.toast({
        tone: 'success',
        message: strings.archivedToast(table.label),
        action: { label: strings.undo, onAction: () => void store.restoreTable(slug, place.id, table.id).then(said) },
      });
    });
  };
  /** One change for every ticked table, one after another (the store keeps them in order). */
  const forTicked = (run: (table: DiningTable) => Promise<{ readonly message: string } | undefined>) => {
    const tables = ticked;
    setSelected(new Set());
    void Promise.all(tables.map(run)).then((answers) => said(answers.find((each) => each !== undefined)));
  };

  const tableCell = (table: DiningTable, column: string) => {
    switch (column) {
      case 'label':
        return table.label;
      case 'area':
        return table.areaId === undefined ? '' : (areaNames.get(table.areaId) ?? '');
      case 'seats':
        return strings.seatsRange(table.minGuests, table.maxGuests);
      case 'joins':
        return table.joins.map((id) => labels.get(id) ?? '').join(', ');
      case 'online':
        return (
          <Switch
            label={strings.onlineFor(table.label)}
            isLabelHidden
            isSelected={table.online}
            onChange={(online) => {
              void store.updateTable(slug, place.id, table.id, { online }).then(said);
            }}
          />
        );
      default:
        return (
          <MenuTrigger>
            <Button variant="ghost" icon="ellipsis" label={strings.tableActions(table.label)} />
            <Menu
              label={strings.tableActions(table.label)}
              onAction={(key) => {
                if (key === 'edit') setEditing({ kind: 'table', table });
                if (key === 'archive') archive(table);
                if (key === 'delete') setEditing({ kind: 'delete', table });
              }}
            >
              <MenuItem id="edit" icon="pencil">
                {strings.edit}
              </MenuItem>
              <MenuItem id="archive" icon="archive">
                {strings.archive}
              </MenuItem>
              <MenuSeparator />
              <MenuItem id="delete" icon="trash" isDanger>
                {strings.delete}
              </MenuItem>
            </Menu>
          </MenuTrigger>
        );
    }
  };

  return (
    <SettingsPage
      title={shown.name}
      crumbs={[{ id: 'business', label: strings.back, href: businessSettingsHref(slug) }]}
    >
      <PlaceSections
        store={store}
        slug={slug}
        place={shown}
        isSaving={business.status === 'ready' && business.isSaving}
        toasts={toasts}
      />
      {state.status === 'error' ? (
        <EmptyState
          title={strings.failed}
          icon="table"
          actions={<Button onPress={() => store.floor(slug, place.id).retry()}>{strings.retry}</Button>}
        />
      ) : (
        <>
          <SettingsSection
            title={strings.tables}
            actions={
              <>
                {/* At the limit the button says why beside it, a lock with the reason, read with the button. */}
                {isFull && (
                  <>
                    <VisuallyHidden id={limitId}>
                      {strings.tablesLimit(HOSPITALITY_LIMITS.tablesPerPlace)}
                    </VisuallyHidden>
                    <LockReason reason={strings.tablesLimit(HOSPITALITY_LIMITS.tablesPerPlace)} />
                  </>
                )}
                <Button
                  variant="primary"
                  icon="plus"
                  isDisabled={floor === undefined || isFull}
                  {...(isFull ? { 'aria-describedby': limitId } : {})}
                  onPress={() => setEditing({ kind: 'add' })}
                >
                  {strings.addTables}
                </Button>
              </>
            }
          >
            {ticked.length > 0 && floor !== undefined && (
              <BulkActionBar count={ticked.length} total={live.length} onClear={() => setSelected(new Set())}>
                <Select
                  savesOnPick
                  label={strings.bulkArea(ticked.length)}
                  isLabelHidden
                  placeholder={strings.area}
                  items={areaItems(floor)}
                  value={null}
                  onChange={(chosen) => {
                    if (chosen === null) return;
                    forTicked((table) =>
                      store.updateTable(slug, place.id, table.id, { areaId: chosen === '' ? null : chosen }),
                    );
                  }}
                />
                <Button
                  onPress={() => forTicked((table) => store.updateTable(slug, place.id, table.id, { online: true }))}
                >
                  {strings.goOnline}
                </Button>
                <Button
                  onPress={() => forTicked((table) => store.updateTable(slug, place.id, table.id, { online: false }))}
                >
                  {strings.goOffline}
                </Button>
                <Button
                  icon="archive"
                  onPress={() => forTicked((table) => store.archiveTable(slug, place.id, table.id))}
                >
                  {strings.archiveSelected}
                </Button>
              </BulkActionBar>
            )}
            <Table
              label={strings.openTables(place.name)}
              columns={TABLE_COLUMNS}
              rows={live}
              getRowId={(table) => table.id}
              getRowLabel={(table) => table.label}
              selected={selected}
              onSelectedChange={setSelected}
              getSelectLabel={(table) => strings.selectTable(table.label)}
              isLoading={floor === undefined}
              isScrollable
              renderCell={tableCell}
              onRowAction={(id) => {
                const table = live.find((each) => each.id === id);
                if (table !== undefined) setEditing({ kind: 'table', table });
              }}
              onReorder={(id, targetId, position) => {
                const rest = live.filter((table) => table.id !== id);
                const at = rest.findIndex((table) => table.id === targetId);
                if (at < 0) return;
                void store.moveTable(slug, place.id, id, at + (position === 'after' ? 1 : 0)).then(said);
              }}
              emptyState={
                <EmptyState
                  title={strings.noTables}
                  icon="table"
                  actions={
                    <Button variant="primary" icon="plus" onPress={() => setEditing({ kind: 'add' })}>
                      {strings.addTables}
                    </Button>
                  }
                >
                  {strings.noTablesText}
                </EmptyState>
              }
            />
            {archived.length > 0 && (
              <Disclosure title={strings.archived} count={archived.length} variant="quiet">
                <Table
                  label={strings.archived}
                  columns={[
                    { id: 'label', label: strings.label, isRowHeader: true, size: 'fill' },
                    { id: 'actions', label: strings.actions, isLabelHidden: true, align: 'end', size: 'fit' },
                  ]}
                  rows={archived}
                  getRowId={(table) => table.id}
                  isHeaderHidden
                  renderCell={(table, column) =>
                    column === 'label' ? (
                      table.label
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="archive-restore"
                        onPress={() => {
                          void store.restoreTable(slug, place.id, table.id).then(said);
                        }}
                      >
                        {strings.restore}
                      </Button>
                    )
                  }
                />
              </Disclosure>
            )}
          </SettingsSection>
          <SettingsSection
            title={strings.areas}
            actions={
              <Button
                variant="ghost"
                icon="plus"
                isDisabled={floor === undefined || floor.areas.length >= HOSPITALITY_LIMITS.areasPerPlace}
                onPress={() => setEditing({ kind: 'area' })}
              >
                {strings.addArea}
              </Button>
            }
          >
            <Table
              label={strings.areas}
              columns={AREA_COLUMNS}
              rows={floor?.areas ?? []}
              getRowId={(area) => area.id}
              isLoading={floor === undefined}
              renderCell={(area, column) => {
                if (column === 'name') return area.name;
                if (column === 'tables') return strings.tableCount(live.filter((t) => t.areaId === area.id).length);
                return (
                  <MenuTrigger>
                    <Button variant="ghost" icon="ellipsis" label={strings.tableActions(area.name)} />
                    <Menu
                      label={strings.tableActions(area.name)}
                      onAction={(key) => {
                        if (key === 'rename') setEditing({ kind: 'area', area });
                        if (key === 'delete') setEditing({ kind: 'delete-area', area });
                      }}
                    >
                      <MenuItem id="rename" icon="pencil">
                        {strings.renameArea(area.name)}
                      </MenuItem>
                      <MenuItem id="delete" icon="trash" isDanger>
                        {strings.deleteArea(area.name)}
                      </MenuItem>
                    </Menu>
                  </MenuTrigger>
                );
              }}
              emptyState={<EmptyState title={strings.noAreas} />}
            />
          </SettingsSection>
        </>
      )}
      {floor !== undefined && (
        <>
          <AddTablesDialog
            key={editing?.kind === 'add' ? 'open' : 'closed'}
            isOpen={editing?.kind === 'add'}
            onOpenChange={(open) => {
              if (!open) setEditing(undefined);
            }}
            floor={floor}
            onAdd={async (input) => {
              const refused = await store.addTables(slug, place.id, input);
              if (refused !== undefined) throw refused;
            }}
          />
          <TableDialog
            table={editing?.kind === 'table' ? editing.table : undefined}
            floor={floor}
            onClose={() => setEditing(undefined)}
            onSave={async (table, change) => {
              const refused = await store.updateTable(slug, place.id, table.id, change);
              if (refused !== undefined) throw refused;
            }}
          />
          <AreaDialog
            key={editing?.kind === 'area' ? (editing.area?.id ?? 'new') : 'closed'}
            isOpen={editing?.kind === 'area'}
            area={editing?.kind === 'area' ? editing.area : undefined}
            onOpenChange={(open) => {
              if (!open) setEditing(undefined);
            }}
            onSave={async (name, area) => {
              const refused = await store.saveArea(slug, place.id, name, area?.id);
              if (refused !== undefined) throw refused;
            }}
          />
        </>
      )}
      <Modal
        isOpen={editing?.kind === 'delete' || editing?.kind === 'delete-area'}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
        title={strings.deleteTitle(
          editing?.kind === 'delete' ? editing.table.label : editing?.kind === 'delete-area' ? editing.area.name : '',
        )}
        variant="confirm"
        tone="danger"
        actions={
          <>
            <Button slot="close">{strings.cancel}</Button>
            <Button
              variant="danger-solid"
              onPress={() => {
                if (editing?.kind === 'delete') void store.deleteTable(slug, place.id, editing.table.id).then(said);
                if (editing?.kind === 'delete-area') void store.deleteArea(slug, place.id, editing.area.id).then(said);
                setEditing(undefined);
              }}
            >
              {strings.delete}
            </Button>
          </>
        }
      >
        {editing?.kind === 'delete-area' ? strings.deleteAreaText : strings.deleteText}
      </Modal>
    </SettingsPage>
  );
}

/** A whole number from a field, or undefined. */
const whole = (value: string): number | undefined =>
  /^\d{1,3}$/.test(value.trim()) ? Number(value.trim()) : undefined;

/** The area choices: none, then the place's areas. */
const areaItems = (floor: PlaceFloor) => [
  { id: '', label: strings.noArea },
  ...floor.areas.map((area) => ({ id: area.id, label: area.name })),
];

/** Add tables: a label and a run of numbers, the seats, an area; the line under says what it will add. */
function AddTablesDialog({
  isOpen,
  onOpenChange,
  floor,
  onAdd,
}: {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly floor: PlaceFloor;
  readonly onAdd: (input: {
    readonly labels: readonly string[];
    readonly areaId?: string;
    readonly minGuests: number;
    readonly maxGuests: number;
  }) => Promise<void>;
}) {
  const formId = useId();
  // After the highest number any label ends with, archived ones too, so a run never meets a label already held.
  const next = Math.max(0, ...floor.tables.map((table) => Number(/(\d+)$/.exec(table.label)?.[1] ?? '0'))) + 1;
  const [prefix, setPrefix] = useState('T');
  const [from, setFrom] = useState(String(next));
  const [to, setTo] = useState(String(next + 9));
  const [fewest, setFewest] = useState('2');
  const [most, setMost] = useState('4');
  const [areaId, setAreaId] = useState('');
  const [isBusy, setBusy] = useState(false);
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  const start = whole(from);
  const end = whole(to);
  const labels = start === undefined || end === undefined ? undefined : tableLabels(prefix.trim(), start, end);
  const add = () => {
    const min = whole(fewest);
    const max = whole(most);
    if (labels === undefined) {
      setRefusals([{ code: 'INPUT_INVALID', message: strings.rangeInvalid, attributeId: 'to' }]);
      return;
    }
    if (min === undefined || max === undefined || min < 1 || max > 30 || min > max) {
      setRefusals([{ code: 'INPUT_INVALID', message: strings.seatsInvalid, attributeId: 'most' }]);
      return;
    }
    setBusy(true);
    setRefusals([]);
    onAdd({ labels, minGuests: min, maxGuests: max, ...(areaId === '' ? {} : { areaId }) }).then(
      () => {
        setBusy(false);
        onOpenChange(false);
      },
      (error: unknown) => {
        setBusy(false);
        setRefusals(formRefusals(error, ['labels', 'areaId', 'minGuests']));
      },
    );
  };
  return (
    <Modal
      title={strings.addTables}
      variant="window"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open && isBusy) return;
        onOpenChange(open);
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} isPending={isBusy} isDisabled={labels === undefined}>
            {labels === undefined ? strings.addTables : strings.addCount(labels.length)}
          </Button>
        </>
      }
    >
      <Form
        id={formId}
        isBusy={isBusy}
        refusals={refusals}
        fieldFor={(refusal) => refusal.attributeId}
        onSubmit={add}
        label={strings.addTables}
        focusesFirstField
      >
        <FormRow>
          <Field label={strings.prefix} name="prefix" maxLength={8} value={prefix} onChange={setPrefix} />
          <Field label={strings.from} name="from" inputMode="numeric" maxLength={3} value={from} onChange={setFrom} />
          <Field
            label={strings.to}
            name="to"
            inputMode="numeric"
            maxLength={3}
            value={to}
            onChange={setTo}
            hint={strings.preview(labels ?? [])}
          />
        </FormRow>
        <FormRow>
          <Field
            label={strings.fewest}
            name="fewest"
            inputMode="numeric"
            maxLength={2}
            value={fewest}
            onChange={setFewest}
          />
          <Field label={strings.most} name="most" inputMode="numeric" maxLength={2} value={most} onChange={setMost} />
          <Select label={strings.area} items={areaItems(floor)} value={areaId} onChange={(id) => setAreaId(id ?? '')} />
        </FormRow>
      </Form>
    </Modal>
  );
}

/** One table's label, seats, area and joins, saved together. */
function TableDialog({
  table,
  floor,
  onClose,
  onSave,
}: {
  readonly table: DiningTable | undefined;
  readonly floor: PlaceFloor;
  readonly onClose: () => void;
  readonly onSave: (
    table: DiningTable,
    change: { label: string; areaId: string | null; minGuests: number; maxGuests: number; joins: string[] },
  ) => Promise<void>;
}) {
  const formId = useId();
  const [isBusy, setBusy] = useState(false);
  return (
    <Modal
      title={table?.label ?? ''}
      variant="window"
      isOpen={table !== undefined}
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} isPending={isBusy}>
            {isBusy ? strings.saving : strings.save}
          </Button>
        </>
      }
    >
      {table !== undefined && (
        <TableForm
          formId={formId}
          isBusy={isBusy}
          onBusyChange={setBusy}
          table={table}
          floor={floor}
          onClose={onClose}
          onSave={onSave}
        />
      )}
    </Modal>
  );
}

function TableForm({
  formId,
  isBusy,
  onBusyChange: setBusy,
  table,
  floor,
  onClose,
  onSave,
}: {
  readonly formId: string;
  readonly isBusy: boolean;
  readonly onBusyChange: (isBusy: boolean) => void;
  readonly table: DiningTable;
  readonly floor: PlaceFloor;
  readonly onClose: () => void;
  readonly onSave: (
    table: DiningTable,
    change: { label: string; areaId: string | null; minGuests: number; maxGuests: number; joins: string[] },
  ) => Promise<void>;
}) {
  const [label, setLabel] = useState(table.label);
  const [fewest, setFewest] = useState(String(table.minGuests));
  const [most, setMost] = useState(String(table.maxGuests));
  const [areaId, setAreaId] = useState(table.areaId ?? '');
  const [joins, setJoins] = useState<readonly string[]>(table.joins);
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  const others = floor.tables
    .filter((each) => !each.archived && each.id !== table.id)
    .map((each) => ({ id: each.id, label: each.label }));
  const save = () => {
    const min = whole(fewest);
    const max = whole(most);
    if (min === undefined || max === undefined || min < 1 || max > 30 || min > max) {
      setRefusals([{ code: 'INPUT_INVALID', message: strings.seatsInvalid, attributeId: 'maxGuests' }]);
      return;
    }
    setBusy(true);
    setRefusals([]);
    onSave(table, {
      label: label.trim(),
      areaId: areaId === '' ? null : areaId,
      minGuests: min,
      maxGuests: max,
      joins: [...joins],
    }).then(
      () => {
        setBusy(false);
        onClose();
      },
      (error: unknown) => {
        setBusy(false);
        setRefusals(formRefusals(error, ['label', 'minGuests', 'maxGuests', 'joins', 'areaId']));
      },
    );
  };
  return (
    <Form
      id={formId}
      isBusy={isBusy}
      refusals={refusals}
      fieldFor={(refusal) => refusal.attributeId}
      onSubmit={save}
      label={table.label}
      focusesFirstField
    >
      <Field label={strings.label} name="label" maxLength={12} value={label} onChange={setLabel} />
      <FormRow>
        <Field
          label={strings.fewest}
          name="minGuests"
          inputMode="numeric"
          maxLength={2}
          value={fewest}
          onChange={setFewest}
        />
        <Field
          label={strings.most}
          name="maxGuests"
          inputMode="numeric"
          maxLength={2}
          value={most}
          onChange={setMost}
        />
      </FormRow>
      <Select label={strings.area} items={areaItems(floor)} value={areaId} onChange={(id) => setAreaId(id ?? '')} />
      <Select
        label={strings.joins}
        selectionMode="multiple"
        isSearchable
        searchLabel={strings.joins}
        maxVisible={4}
        items={others}
        values={[...joins]}
        onValuesChange={setJoins}
      />
    </Form>
  );
}

/** Add an area, or rename one. */
function AreaDialog({
  isOpen,
  area,
  onOpenChange,
  onSave,
}: {
  readonly isOpen: boolean;
  readonly area: Area | undefined;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly onSave: (name: string, area: Area | undefined) => Promise<void>;
}) {
  const formId = useId();
  const [name, setName] = useState(area?.name ?? '');
  const [isBusy, setBusy] = useState(false);
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  return (
    <Modal
      title={area === undefined ? strings.addArea : strings.renameArea(area.name)}
      variant="window"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open && isBusy) return;
        setName('');
        onOpenChange(open);
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} isPending={isBusy}>
            {area === undefined ? strings.add : strings.save}
          </Button>
        </>
      }
    >
      <Form
        id={formId}
        isBusy={isBusy}
        refusals={refusals}
        fieldFor={(refusal) => refusal.attributeId}
        onSubmit={() => {
          if (isBusy) return;
          if (name.trim() === '') {
            setRefusals([{ code: 'INPUT_INVALID', message: strings.areaMissing, attributeId: 'name' }]);
            return;
          }
          setBusy(true);
          setRefusals([]);
          onSave(name.trim(), area).then(
            () => {
              setBusy(false);
              setName('');
              onOpenChange(false);
            },
            (error: unknown) => {
              setBusy(false);
              setRefusals(formRefusals(error, ['name']));
            },
          );
        }}
        label={strings.areas}
        focusesFirstField
      >
        <Field
          label={strings.areaName}
          placeholder={area?.name ?? strings.areaPlaceholder}
          name="name"
          maxLength={40}
          value={name}
          onChange={setName}
        />
      </Form>
    </Modal>
  );
}
