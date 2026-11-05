// Brief
// Purpose: one table in a drawer on Menu QR's Tables page (after checklabs' Add Table and Edit Table sheet): its
// label, seats and zone (a new zone made from the zone picker), and on edit its code and link to read; One or
// Several in the same drawer adds a run of tables ("T1 to T10").
// Main task: add a table, or a run of them, or change one, in one go.
// Leaves out: joins and online booking (the place's own page), the kind of resource (the page lists tables only, the
// codes are theirs), and a new code (the row's ⋯, since it stops the printed one).
import type { PlaceFloor, Resource } from '@crm/data';
import { HOSPITALITY_LIMITS, resourceLabels } from '@crm/data/hospitality';
import {
  Button,
  Code,
  DescriptionList,
  Field,
  Form,
  FormRow,
  SegmentedControl,
  Select,
  type FormRefusal,
  type Toasts,
} from '@crm/ui';
import { useId, useState } from 'react';
import { DrawerForm } from '../menus/drawer.tsx';
import { formRefusals } from '../settings/refusals.ts';
import { strings } from './strings.ts';

/** The zone picker's value for a zone typed into it, made when the drawer saves. */
const NEW_ZONE = '\u0000new';

/** A whole number from a field (up to three digits), or undefined. */
const whole = (value: string): number | undefined =>
  /^\d{1,3}$/.test(value.trim()) ? Number(value.trim()) : undefined;

/** The seats a field pair says, or undefined when they don't hold together. */
function seatsOf(fewest: string, most: string): { readonly min: number; readonly max: number } | undefined {
  const min = whole(fewest);
  const max = whole(most);
  if (min === undefined || max === undefined) return undefined;
  if (min < HOSPITALITY_LIMITS.capacityMin || max > HOSPITALITY_LIMITS.capacityMax || min > max) return undefined;
  return { min, max };
}

/** What adding sends: the labels, the zone and the seats. */
export interface AddTablesInput {
  readonly labels: readonly string[];
  readonly areaId?: string;
  readonly minCapacity: number;
  readonly maxCapacity: number;
}

/** What a saved table sends: every field the drawer shows. */
export interface TableChange {
  readonly label: string;
  readonly areaId: string | null;
  readonly minCapacity: number;
  readonly maxCapacity: number;
}

/** Props for TableDrawer: a new table (no `table`) or one already made, with its code to read. */
export interface TableDrawerProps {
  readonly floor: PlaceFloor;
  /** The table to change; left out, the drawer adds. */
  readonly table?: Resource;
  /** The table's code and the address it opens (edit only), shown read only. */
  readonly code?: { readonly code: string; readonly address: string };
  /** The zone the page shows, where a new table starts (an area id), or undefined. */
  readonly startZone?: string;
  /** Makes a zone typed into the picker; answers its id, or throws the refusal. */
  readonly onCreateZone: (name: string) => Promise<string>;
  readonly onAdd: (input: AddTablesInput) => Promise<void>;
  readonly onSave: (table: Resource, change: TableChange) => Promise<void>;
  readonly onClose: () => void;
  readonly toasts: Toasts;
}

/** Add table or Edit table, one drawer for both. */
export function TableDrawer({
  floor,
  table,
  code,
  startZone,
  onCreateZone,
  onAdd,
  onSave,
  onClose,
  toasts,
}: TableDrawerProps) {
  const formId = useId();
  const isNew = table === undefined;
  // A run starts after the highest number any label ends with, archived ones too, so it never meets one held.
  const next = Math.max(0, ...floor.resources.map((each) => Number(/(\d+)$/.exec(each.label)?.[1] ?? '0'))) + 1;
  const zones = [...floor.areas].sort((a, b) => a.position - b.position);
  const startArea = table?.areaId ?? startZone;
  const initialZone = startArea !== undefined && zones.some((area) => area.id === startArea) ? startArea : '';
  const [mode, setMode] = useState<'one' | 'several'>('one');
  const [label, setLabel] = useState(table?.label ?? '');
  const [fewest, setFewest] = useState(String(table?.minCapacity ?? 2));
  const [most, setMost] = useState(String(table?.maxCapacity ?? 4));
  const [zone, setZone] = useState(initialZone);
  const [newZone, setNewZone] = useState<string>();
  const [prefix, setPrefix] = useState('T');
  const [from, setFrom] = useState(String(next));
  const [to, setTo] = useState(String(next + 9));
  const [isBusy, setBusy] = useState(false);
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  const start = whole(from);
  const end = whole(to);
  const run = start === undefined || end === undefined ? undefined : resourceLabels(prefix.trim(), start, end);
  const isSeveral = isNew && mode === 'several';
  const isDirty =
    label !== (table?.label ?? '') ||
    fewest !== String(table?.minCapacity ?? 2) ||
    most !== String(table?.maxCapacity ?? 4) ||
    zone !== initialZone ||
    (isSeveral && (prefix !== 'T' || from !== String(next) || to !== String(next + 9)));

  const zoneItems = [
    { id: '', label: strings.unzoned },
    ...zones.map((area) => ({ id: area.id, label: area.name })),
    ...(newZone === undefined ? [] : [{ id: NEW_ZONE, label: newZone }]),
  ];

  /** What doesn't hold together, on its field, before anything is sent; undefined when all of it does. */
  const problem = (): { readonly message: string; readonly field: string } | undefined => {
    if (!isSeveral && label.trim() === '') return { message: strings.labelMissing, field: 'label' };
    if (isSeveral && run === undefined) return { message: strings.rangeInvalid, field: 'to' };
    if (seatsOf(fewest, most) === undefined) return { message: strings.seatsInvalid, field: 'maxCapacity' };
    return undefined;
  };

  const save = async () => {
    const found = problem();
    const seats = seatsOf(fewest, most);
    if (found !== undefined || seats === undefined) {
      if (found !== undefined)
        setRefusals([{ code: 'INPUT_INVALID', message: found.message, attributeId: found.field }]);
      return;
    }
    setBusy(true);
    setRefusals([]);
    try {
      // A zone typed into the picker is made first, so the table lands in it; from then on the drawer holds the
      // zone made, so a Save tried again after a refusal never makes it twice.
      let areaId = zone;
      if (zone === NEW_ZONE && newZone !== undefined) {
        areaId = await onCreateZone(newZone);
        setZone(areaId);
        setNewZone(undefined);
      }
      if (table !== undefined) {
        await onSave(table, {
          label: label.trim(),
          areaId: areaId === '' ? null : areaId,
          minCapacity: seats.min,
          maxCapacity: seats.max,
        });
        toasts.toast({ tone: 'success', message: strings.updated(label.trim()) });
      } else {
        const labels = isSeveral ? (run ?? []) : [label.trim()];
        await onAdd({
          labels,
          ...(areaId === '' ? {} : { areaId }),
          minCapacity: seats.min,
          maxCapacity: seats.max,
        });
        toasts.toast({
          tone: 'success',
          message: labels.length === 1 ? strings.created(labels[0] ?? '') : strings.createdMany(labels.length),
        });
      }
      setBusy(false);
      onClose();
    } catch (error: unknown) {
      setBusy(false);
      setRefusals(formRefusals(error, ['label', 'labels', 'areaId', 'name', 'minCapacity', 'maxCapacity']));
    }
  };

  const zonePicker = (
    <Select
      label={strings.zone}
      items={zoneItems}
      value={zone}
      searchLabel={strings.zoneSearch}
      onChange={(id) => setZone(id ?? '')}
      onCreate={(typed) => {
        const name = typed.trim();
        if (name === '') return;
        // A zone already there by that name is chosen, never made twice.
        const held = zones.find((area) => area.name.toLowerCase() === name.toLowerCase());
        if (held !== undefined) {
          setZone(held.id);
          return;
        }
        setNewZone(name.slice(0, HOSPITALITY_LIMITS.areaNameMax));
        setZone(NEW_ZONE);
      }}
    />
  );
  const seatsRow = (
    <FormRow>
      <Field
        label={strings.fewest}
        name="minCapacity"
        inputMode="numeric"
        maxLength={3}
        value={fewest}
        onChange={setFewest}
      />
      <Field
        label={strings.most}
        name="maxCapacity"
        inputMode="numeric"
        maxLength={3}
        value={most}
        onChange={setMost}
      />
    </FormRow>
  );
  const count = isSeveral ? (run?.length ?? 0) : 1;

  return (
    <DrawerForm
      title={isNew ? strings.addTitle : strings.editTitle}
      isDirty={isDirty}
      isBusy={isBusy}
      onClose={onClose}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          {/* Never off: a run that doesn't hold together says why on its field when pressed. */}
          <Button variant="primary" type="submit" form={formId} isPending={isBusy}>
            {!isNew ? strings.saveTable : isSeveral ? strings.createTables(count) : strings.createTable}
          </Button>
        </>
      }
    >
      {/* One or Several sits above the form, so the form's first field (Label) takes focus as the drawer opens. */}
      {isNew ? (
        <SegmentedControl
          label={strings.how}
          segments={[
            { value: 'one', label: strings.one },
            { value: 'several', label: strings.several },
          ]}
          value={mode}
          onChange={(value) => setMode(value === 'several' ? 'several' : 'one')}
        />
      ) : null}
      <Form
        id={formId}
        isBusy={isBusy}
        refusals={refusals}
        fieldFor={(refusal) => (refusal.attributeId === 'labels' ? (isSeveral ? 'to' : 'label') : refusal.attributeId)}
        onSubmit={() => void save()}
        label={isNew ? strings.addTitle : strings.editTitle}
        focusesFirstField
      >
        {isSeveral ? (
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
              hint={strings.preview(run ?? [])}
            />
          </FormRow>
        ) : (
          <Field
            label={strings.label}
            name="label"
            placeholder={strings.labelPlaceholder}
            maxLength={HOSPITALITY_LIMITS.labelMax}
            value={label}
            onChange={setLabel}
            isRequired
          />
        )}
        {seatsRow}
        {zonePicker}
        {code === undefined ? null : (
          <DescriptionList
            items={[
              {
                term: strings.code,
                description: <Code>{code.code}</Code>,
                copy: { value: code.code, label: strings.copyCode },
              },
              { term: strings.link, description: code.address, copy: { value: code.address, label: strings.copyLink } },
            ]}
          />
        )}
      </Form>
    </DrawerForm>
  );
}
