// Brief
// Purpose: one place of the business (spec 0065, AC-6508): its week of opening hours, its special days, its details.
// Main task: set the hours (saved as each changes), add a special day, and get to the place's tables.
// Leaves out: reservation hours and pacing (Table seating's own rules, H3), and the floor itself (its own page).
import type { HoursException, HospitalityStore, Place, PlaceFields, PlaceHours, WeekDay } from '@crm/data';
import { hoursProblem } from '@crm/data/hospitality';
import {
  Button,
  ButtonLink,
  Card,
  CountryPicker,
  DatePicker,
  Disclosure,
  EmptyState,
  Field,
  FieldGroup,
  Form,
  formatDate,
  HoursEditor,
  Modal,
  SegmentedControl,
  Select,
  Table,
  useFormatSettings,
  type FormRefusal,
  type TableColumn,
  type Toasts,
} from '@crm/ui';
import { useId, useMemo, useState } from 'react';
import { zoneItems, zoneMatches } from '../booking/hours.ts';
import { formRefusals } from '../settings/refusals.ts';
import { placeTablesHref } from '../settings/nav.ts';
import { fromEditor, isWeekDay, weekRows, withDay, type EditorRange } from './hours-rows.ts';
import { dayName, strings } from './strings.ts';

/** How late a window may run into the next morning: a bar's 2 AM, with room to spare. */
const LATE_UNTIL = '06:00';

/** Props for one place's card. */
export interface PlaceCardProps {
  readonly store: HospitalityStore;
  readonly slug: string;
  readonly place: Place;
  readonly toasts: Toasts;
}

/** A place's address on one line. */
const addressOf = (place: Place) =>
  [place.addressLine, place.city, place.postcode].filter((part) => part !== undefined && part !== '').join(', ');

/** One place: the tables it has, its hours, its special days and its details. */
export function PlaceCard({ store, slug, place, toasts }: PlaceCardProps) {
  const [dayError, setDayError] = useState<{ readonly day: WeekDay; readonly message: string } | undefined>(undefined);
  const [isAddingDay, setAddingDay] = useState(false);
  const saveHours = (hours: PlaceHours) => {
    void store.updatePlace(slug, place.id, { hours }).then((refused) => {
      if (refused !== undefined) toasts.toast({ tone: 'danger', message: refused.message });
    });
  };
  const address = addressOf(place);
  return (
    <Card
      title={place.name}
      {...(address === '' ? {} : { description: address })}
      actions={
        <ButtonLink href={placeTablesHref(slug, place.id)} icon="table" variant="ghost">
          {strings.tableCount(place.tables)}
        </ButtonLink>
      }
    >
      <HoursEditor
        label={strings.hours}
        rows={weekRows(place.hours, dayName, dayError)}
        pastMidnightUntil={LATE_UNTIL}
        onChange={(day, ranges) => {
          if (!isWeekDay(day)) return;
          const next = withDay(place.hours, day, ranges);
          if (next.problem !== undefined) {
            setDayError({ day, message: next.problem });
            return;
          }
          setDayError(undefined);
          saveHours(next.hours);
        }}
      />
      <SpecialDays
        place={place}
        onRemove={(date) => {
          saveHours({ ...place.hours, exceptions: place.hours.exceptions.filter((each) => each.date !== date) });
        }}
        onAdd={() => setAddingDay(true)}
      />
      <Disclosure title={strings.placeDetails} variant="quiet">
        <DetailsForm
          key={place.updatedAt}
          place={place}
          onSave={async (fields) => {
            const refused = await store.updatePlace(slug, place.id, { place: fields });
            if (refused !== undefined) throw refused;
            toasts.toast({ tone: 'success', message: strings.saved });
          }}
        />
      </Disclosure>
      <SpecialDayDialog
        isOpen={isAddingDay}
        onOpenChange={setAddingDay}
        taken={place.hours.exceptions.map((each) => each.date)}
        onAdd={(exception) => {
          const hours: PlaceHours = {
            ...place.hours,
            exceptions: [...place.hours.exceptions, exception].sort((a, b) => a.date.localeCompare(b.date)),
          };
          const problem = hoursProblem(hours);
          if (problem !== undefined) return problem;
          saveHours(hours);
          return undefined;
        }}
      />
    </Card>
  );
}

const DAY_COLUMNS: readonly TableColumn[] = [
  { id: 'date', label: strings.date, isRowHeader: true },
  { id: 'hours', label: strings.hours },
  { id: 'note', label: strings.note, size: 'fill' },
  { id: 'remove', label: strings.actions, isLabelHidden: true, align: 'end', size: 'fit' },
];

/** The place's special days, under a quiet disclosure, with Add day. */
function SpecialDays({
  place,
  onRemove,
  onAdd,
}: {
  readonly place: Place;
  readonly onRemove: (date: string) => void;
  readonly onAdd: () => void;
}) {
  const { locale } = useFormatSettings();
  const days = place.hours.exceptions;
  const hoursText = (exception: HoursException) =>
    exception.closed === true
      ? strings.closed
      : (exception.ranges ?? []).map((range) => strings.rangeText(range.from, range.to)).join(', ');
  return (
    <Disclosure
      title={strings.specialDays}
      variant="quiet"
      count={days.length}
      actions={
        <Button variant="ghost" size="sm" icon="plus" onPress={onAdd}>
          {strings.addSpecialDay}
        </Button>
      }
    >
      <Table
        label={strings.specialDays}
        columns={DAY_COLUMNS}
        rows={days}
        getRowId={(exception) => exception.date}
        isHeaderHidden
        renderCell={(exception, column) => {
          switch (column) {
            case 'date':
              return formatDate(exception.date, locale);
            case 'hours':
              return hoursText(exception);
            case 'note':
              return exception.note ?? '';
            default:
              return (
                <Button
                  variant="ghost"
                  size="sm"
                  icon="trash"
                  label={strings.removeDay(formatDate(exception.date, locale))}
                  onPress={() => onRemove(exception.date)}
                />
              );
          }
        }}
        emptyState={<EmptyState title={strings.noSpecialDays} />}
      />
    </Disclosure>
  );
}

/** A special day: its date, closed or its own hours, and a note. */
function SpecialDayDialog({
  isOpen,
  onOpenChange,
  taken,
  onAdd,
}: {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly taken: readonly string[];
  /** Adds the day; answers what is wrong with it, or undefined once it is on its way. */
  readonly onAdd: (exception: HoursException) => string | undefined;
}) {
  const formId = useId();
  const [date, setDate] = useState<string | null>(null);
  const [mode, setMode] = useState<'closed' | 'hours'>('closed');
  const [ranges, setRanges] = useState<readonly EditorRange[]>([['12:00', '15:00']]);
  const [note, setNote] = useState('');
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  const add = () => {
    if (date === null || taken.includes(date)) {
      setRefusals([{ code: 'INPUT_INVALID', message: strings.pickDate, attributeId: 'date' }]);
      return;
    }
    const problem = onAdd({
      date,
      ...(mode === 'closed' ? { closed: true } : { ranges: ranges.map((range) => fromEditor(range, undefined)) }),
      ...(note.trim() === '' ? {} : { note: note.trim() }),
    });
    if (problem !== undefined) {
      setRefusals([{ code: 'INPUT_INVALID', message: problem }]);
      return;
    }
    setRefusals([]);
    setDate(null);
    setNote('');
    onOpenChange(false);
  };
  return (
    <Modal
      title={strings.addSpecialDay}
      variant="window"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      actions={
        <>
          <Button slot="close">{strings.cancel}</Button>
          <Button variant="primary" type="submit" form={formId}>
            {strings.add}
          </Button>
        </>
      }
    >
      <Form
        id={formId}
        refusals={refusals}
        fieldFor={(refusal) => refusal.attributeId}
        onSubmit={add}
        label={strings.addSpecialDay}
        focusesFirstField
      >
        <DatePicker label={strings.date} isRequired value={date} onChange={setDate} />
        <SegmentedControl
          label={strings.hours}
          segments={[
            { value: 'closed', label: strings.closed },
            { value: 'hours', label: strings.openHours },
          ]}
          value={mode}
          onChange={(next) => setMode(next === 'hours' ? 'hours' : 'closed')}
        />
        {mode === 'hours' && (
          <HoursEditor
            label={strings.openHours}
            isSingleDay
            pastMidnightUntil={LATE_UNTIL}
            rows={[{ id: 'day', label: strings.openHours, ranges }]}
            onChange={(_day, next) => setRanges(next)}
          />
        )}
        <Field
          label={strings.note}
          placeholder={strings.notePlaceholder}
          name="note"
          maxLength={60}
          value={note}
          onChange={setNote}
        />
      </Form>
    </Modal>
  );
}

const DETAIL_FIELDS = ['name', 'addressLine', 'city', 'postcode', 'country', 'timeZone', 'phone'] as const;

/** The place's address, time zone and phone, saved together. */
function DetailsForm({
  place,
  onSave,
}: {
  readonly place: Place;
  readonly onSave: (fields: PlaceFields) => Promise<void>;
}) {
  const formId = useId();
  const [name, setName] = useState(place.name);
  const [addressLine, setAddressLine] = useState(place.addressLine ?? '');
  const [city, setCity] = useState(place.city ?? '');
  const [postcode, setPostcode] = useState(place.postcode ?? '');
  const [country, setCountry] = useState<string | null>(place.country);
  const [timeZone, setTimeZone] = useState(place.timeZone);
  const [phone, setPhone] = useState(place.phone ?? '');
  const [isBusy, setBusy] = useState(false);
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  const zones = useMemo(() => zoneItems(timeZone, new Date()), [timeZone]);
  const save = () => {
    if (isBusy || country === null) return;
    setBusy(true);
    setRefusals([]);
    onSave({ name, addressLine, city, postcode, country, timeZone, phone, locale: place.locale }).then(
      () => setBusy(false),
      (error: unknown) => {
        setBusy(false);
        setRefusals(formRefusals(error, DETAIL_FIELDS));
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
      label={strings.placeDetails}
    >
      <FieldGroup label={strings.placeName} layout="row">
        <Field label={strings.placeName} name="name" maxLength={80} value={name} onChange={setName} />
        <Field label={strings.phone} name="phone" type="tel" maxLength={40} value={phone} onChange={setPhone} />
      </FieldGroup>
      <Field label={strings.address} name="addressLine" maxLength={200} value={addressLine} onChange={setAddressLine} />
      <FieldGroup label={strings.address} layout="row">
        <Field label={strings.city} name="city" maxLength={100} value={city} onChange={setCity} />
        <Field label={strings.postcode} name="postcode" maxLength={20} value={postcode} onChange={setPostcode} />
      </FieldGroup>
      <FieldGroup label={strings.country} layout="row">
        <CountryPicker label={strings.country} list="all" value={country} onChange={setCountry} />
        <Select
          label={strings.timeZone}
          items={zones}
          filter={zoneMatches}
          isSearchable
          value={timeZone}
          onChange={(zone) => {
            if (zone !== null) setTimeZone(zone);
          }}
        />
      </FieldGroup>
      <Button type="submit" form={formId} isPending={isBusy}>
        {isBusy ? strings.saving : strings.save}
      </Button>
    </Form>
  );
}
