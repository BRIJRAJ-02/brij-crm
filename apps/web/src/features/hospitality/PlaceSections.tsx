// Brief
// Purpose: one place's opening hours, special days and details (spec 0065, AC-6508), the top of the place's page.
// Main task: set the week's hours (saved as each changes, said quietly), add or remove a special day, fix the address.
// Leaves out: reservation hours and pacing (Table seating's own rules, H3), and the tables (below, on the same page).
import type { HoursException, HospitalityStore, Place, PlaceFields, PlaceHours, WeekDay } from '@crm/data';
import { hoursProblem } from '@crm/data/hospitality';
import {
  Button,
  Card,
  CountryPicker,
  DatePicker,
  EmptyState,
  Field,
  Form,
  formatDate,
  FormRow,
  HoursEditor,
  Modal,
  SegmentedControl,
  Select,
  SettingsSection,
  Table,
  useFormatSettings,
  type FormRefusal,
  type TableColumn,
  type Toasts,
} from '@crm/ui';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { zoneItems, zoneMatches } from '../booking/hours.ts';
import { formRefusals } from '../settings/refusals.ts';
import { clockLabel, fromEditor, isWeekDay, weekRows, withDay, type EditorRange } from './hours-rows.ts';
import { dayName, strings } from './strings.ts';

/** How late a window may run into the next morning: a bar's 2 AM, with room to spare. */
const LATE_UNTIL = '06:00';

/** How long "Saved" stays beside the hours once a save lands. */
const SAVED_FOR_MS = 2_000;

/** Props for a place's sections. */
export interface PlaceSectionsProps {
  readonly store: HospitalityStore;
  readonly slug: string;
  readonly place: Place;
  /** Whether a change is on its way (the business copy's own flag). */
  readonly isSaving: boolean;
  readonly toasts: Toasts;
}

/** A day's windows as typed while they don't hold together, and why; drawn in place of the stored ones. */
interface DayDraft {
  readonly day: WeekDay;
  readonly ranges: readonly EditorRange[];
  readonly message: string;
}

/** Opening hours, special days and details, as three sections. */
export function PlaceSections({ store, slug, place, isSaving, toasts }: PlaceSectionsProps) {
  const [draft, setDraft] = useState<DayDraft | undefined>(undefined);
  const [isAddingDay, setAddingDay] = useState(false);
  const status = useSavedStatus(isSaving);
  const saveHours = (hours: PlaceHours) =>
    store.updatePlace(slug, place.id, { hours }).then((refused) => {
      if (refused !== undefined) toasts.toast({ tone: 'danger', message: refused.message });
      return refused;
    });
  const rows = weekRows(place.hours, dayName).map((row) =>
    draft?.day === row.id ? { ...row, ranges: draft.ranges, error: draft.message } : row,
  );
  return (
    <>
      <SettingsSection
        title={strings.hours}
        {...(status === undefined
          ? {}
          : { description: status === 'saving' ? strings.savingHours : strings.savedHours })}
      >
        <Card>
          <HoursEditor
            label={strings.hours}
            rows={rows}
            pastMidnightUntil={LATE_UNTIL}
            onChange={(day, ranges) => {
              if (!isWeekDay(day)) return;
              const next = withDay(place.hours, day, ranges);
              // Hours that don't hold together stay on screen as typed, with why, until they do.
              if (next.problem !== undefined) {
                setDraft({ day, ranges, message: next.problem });
                return;
              }
              setDraft(undefined);
              void saveHours(next.hours);
            }}
          />
        </Card>
      </SettingsSection>
      <SpecialDays
        place={place}
        onAdd={() => setAddingDay(true)}
        onRemove={(date) => {
          const before = place.hours;
          void saveHours({ ...before, exceptions: before.exceptions.filter((each) => each.date !== date) }).then(
            (refused) => {
              if (refused !== undefined) return;
              toasts.toast({
                tone: 'success',
                message: strings.dayRemoved,
                action: { label: strings.undo, onAction: () => void saveHours(before) },
              });
            },
          );
        }}
      />
      <SettingsSection title={strings.placeDetails}>
        <DetailsCard
          // A new answer for these fields starts the form again; an hours save leaves what is typed here alone.
          key={JSON.stringify([
            place.name,
            place.addressLine,
            place.city,
            place.postcode,
            place.country,
            place.timeZone,
            place.phone,
          ])}
          place={place}
          onSave={async (fields) => {
            const refused = await store.updatePlace(slug, place.id, { place: fields });
            if (refused !== undefined) throw refused;
            toasts.toast({ tone: 'success', message: strings.saved });
          }}
        />
      </SettingsSection>
      <SpecialDayDialog
        key={isAddingDay ? 'open' : 'closed'}
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
          void saveHours(hours);
          return undefined;
        }}
      />
    </>
  );
}

/** "saving" while a change is out, "saved" for a moment after, else nothing: the hours' quiet line. */
function useSavedStatus(isSaving: boolean): 'saving' | 'saved' | undefined {
  const [saved, setSaved] = useState(false);
  const was = useRef(isSaving);
  useEffect(() => {
    if (was.current && !isSaving) {
      setSaved(true);
      const timer = setTimeout(() => setSaved(false), SAVED_FOR_MS);
      was.current = isSaving;
      return () => clearTimeout(timer);
    }
    was.current = isSaving;
    return undefined;
  }, [isSaving]);
  return isSaving ? 'saving' : saved ? 'saved' : undefined;
}

const DAY_COLUMNS: readonly TableColumn[] = [
  { id: 'date', label: strings.date, isRowHeader: true, size: 'fit' },
  { id: 'hours', label: strings.hours, size: 'fit' },
  { id: 'note', label: strings.note, size: 'fill' },
  { id: 'remove', label: strings.actions, isLabelHidden: true, align: 'end', size: 'fit' },
];

/** The place's special days, with Add day. */
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
  const hoursText = (exception: HoursException) =>
    exception.closed === true
      ? strings.closed
      : (exception.ranges ?? [])
          .map((range) => strings.rangeText(clockLabel(range.from, locale), clockLabel(range.to, locale)))
          .join(', ');
  return (
    <SettingsSection
      title={strings.specialDays}
      actions={
        <Button variant="ghost" icon="plus" onPress={onAdd}>
          {strings.addSpecialDay}
        </Button>
      }
    >
      <Table
        label={strings.specialDays}
        columns={DAY_COLUMNS}
        rows={place.hours.exceptions}
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
    </SettingsSection>
  );
}

/** A special day: its date, closed or its own hours, and a note. Mounted afresh with each opening. */
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
    onOpenChange(false);
  };
  return (
    <Modal
      title={strings.specialDay}
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
        label={strings.specialDay}
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

/** The place's address, time zone and phone, saved together with the card's Save, as the profile is. */
function DetailsCard({
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
  const changed =
    name !== place.name ||
    addressLine !== (place.addressLine ?? '') ||
    city !== (place.city ?? '') ||
    postcode !== (place.postcode ?? '') ||
    country !== place.country ||
    timeZone !== place.timeZone ||
    phone !== (place.phone ?? '');
  const save = () => {
    if (isBusy || !changed) return;
    if (country === null) {
      setRefusals([{ code: 'INPUT_INVALID', message: strings.countryMissing, attributeId: 'country' }]);
      return;
    }
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
    <Card
      footer={
        <Button variant="primary" type="submit" form={formId} isPending={isBusy} isDisabled={!changed}>
          {isBusy ? strings.saving : strings.save}
        </Button>
      }
    >
      <Form
        id={formId}
        isBusy={isBusy}
        refusals={refusals}
        fieldFor={(refusal) => refusal.attributeId}
        onSubmit={save}
        label={strings.placeDetails}
      >
        <FormRow>
          <Field label={strings.placeName} name="name" maxLength={80} value={name} onChange={setName} />
          <Field label={strings.phone} name="phone" type="tel" maxLength={40} value={phone} onChange={setPhone} />
        </FormRow>
        <Field
          label={strings.address}
          name="addressLine"
          maxLength={200}
          value={addressLine}
          onChange={setAddressLine}
        />
        <FormRow>
          <Field label={strings.city} name="city" maxLength={100} value={city} onChange={setCity} />
          <Field label={strings.postcode} name="postcode" maxLength={20} value={postcode} onChange={setPostcode} />
        </FormRow>
        <FormRow>
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
        </FormRow>
      </Form>
    </Card>
  );
}
