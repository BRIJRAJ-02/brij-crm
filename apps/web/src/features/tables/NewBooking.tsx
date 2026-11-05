// Brief
// Purpose: the Service screen's two sheets after checklabs' reservations page: New booking (a reservation the host
//   takes on the phone or at the desk) and a booking's detail (who, when, how to reach them, and the next move).
// Main task: take a booking in one sheet (name, day and time, party, a table that fits or the best free one, phone,
//   email, notes) and read or move one booking without leaving the day.
// Leaves out: checklabs' "Unassigned (host picks at arrival)": our engine holds a table for every booking, so the
//   choice is "Best free table" (the engine's best fit) or a table that seats the party. No waitlist (no model yet).
import type { Area, Resource, ServiceVisit, TablesStore, VisitStatus } from '@crm/data';
import {
  Badge,
  Button,
  Callout,
  DescriptionList,
  Field,
  Link,
  Modal,
  Select,
  type DescriptionItem,
  type Hue,
} from '@crm/ui';
import { useState, type ReactNode } from 'react';
import { instantAt } from '../bookings/week.ts';
import { strings } from './strings.ts';

/** The party a new booking starts with (checklabs' default). */
const DEFAULT_PARTY = 2;

/** The time a new booking starts at when no hour was picked on the calendar (checklabs' default). */
export const DEFAULT_BOOKING_MINUTE = 19 * 60;

/** "19:00" from minutes past midnight. */
export const clockOf = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** Minutes past midnight from "19:00", or undefined. */
const minuteOfClock = (clock: string) => {
  const match = /^(\d{2}):(\d{2})$/.exec(clock);
  if (match === null) return undefined;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  return minute < 24 * 60 ? minute : undefined;
};

/** The tables that seat a party alone (checklabs offers only tables that fit), in floor order. */
export const tablesFor = (tables: readonly Resource[], party: number) =>
  tables.filter((table) => !table.archived && table.minCapacity <= party && table.maxCapacity >= party);

/** Which id the table Select uses for the engine's pick. */
const BEST = 'best';

/**
 * New booking (checklabs' sheet, in its order): Guest name, Date and Time (the page's day, 19:00 or the hour picked on
 * the calendar), Party size (2), Assign table (only tables that seat the party, else the best free one), Phone and
 * Email (optional), Notes. Cancel, then Create booking; a refusal (the time or table taken) says so and keeps the sheet.
 */
export function NewBookingDialog({
  slug,
  tables,
  placeId,
  zone,
  date,
  minute,
  floorTables,
  areas,
  onClose,
  onBooked,
}: {
  readonly slug: string;
  readonly tables: TablesStore;
  readonly placeId: string;
  readonly zone: string;
  readonly date: string;
  readonly minute: number;
  readonly floorTables: readonly Resource[];
  readonly areas: readonly Area[];
  readonly onClose: () => void;
  readonly onBooked: (name: string, day: string) => void;
}) {
  const [name, setName] = useState('');
  const [day, setDay] = useState(date);
  const [clock, setClock] = useState(clockOf(minute));
  const [partyText, setPartyText] = useState(String(DEFAULT_PARTY));
  const [table, setTable] = useState(BEST);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | undefined>();
  const [tried, setTried] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const party = /^\d+$/.test(partyText) ? Number(partyText) : undefined;
  const partyOk = party !== undefined && party >= 1 && party <= 100;
  const fitting = partyOk ? tablesFor(floorTables, party) : [];
  const areaOf = (id: string | undefined) => areas.find((area) => area.id === id)?.name;
  // A table picked for a party it no longer seats goes back to the best free one.
  const shownTable = table === BEST || fitting.some((each) => each.id === table) ? table : BEST;
  const at = minuteOfClock(clock);
  const errors = {
    name: name.trim() === '' ? strings.bookNameRequired : undefined,
    day: /^\d{4}-\d{2}-\d{2}$/.test(day) ? undefined : strings.bookDayRequired,
    time: at === undefined ? strings.bookTimeRequired : undefined,
    party: partyOk ? undefined : strings.bookPartyRange,
  };

  const create = () => {
    setTried(true);
    if (isSaving || Object.values(errors).some((each) => each !== undefined) || at === undefined || !partyOk) return;
    setSaving(true);
    setProblem(undefined);
    void tables
      .book(slug, placeId, date, {
        start: instantAt(day, at, zone).toISOString(),
        party,
        name,
        phone,
        email,
        note,
        ...(shownTable === BEST ? {} : { resourceIds: [shownTable] }),
      })
      .then((refused) => {
        setSaving(false);
        if (refused === undefined) {
          onBooked(name.trim(), day);
          return;
        }
        setProblem(refused.message);
      });
  };

  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open && !isSaving) onClose();
      }}
      title={strings.newBooking}
      icon="calendar-plus"
      variant="drawer"
      isDismissable={false}
      isBusy={isSaving}
      actions={
        <>
          <Button slot="close" isDisabled={isSaving}>
            {strings.cancel}
          </Button>
          <Button variant="primary" isPending={isSaving} onPress={create}>
            {isSaving ? strings.creatingBooking : strings.createBooking}
          </Button>
        </>
      }
    >
      {problem !== undefined && (
        <Callout tone="danger" isAnnounced>
          {problem}
        </Callout>
      )}
      <Field
        label={strings.guestName}
        placeholder={strings.guestNamePlaceholder}
        name="guest-name"
        autoComplete="off"
        isRequired
        maxLength={120}
        value={name}
        onChange={setName}
        onSubmit={create}
        {...(tried && errors.name !== undefined ? { error: errors.name } : {})}
      />
      <Field
        label={strings.bookDate}
        name="booking-date"
        temporal={{ type: 'date' }}
        isRequired
        value={day}
        onChange={setDay}
        {...(tried && errors.day !== undefined ? { error: errors.day } : {})}
      />
      <Field
        label={strings.bookTime}
        name="booking-time"
        temporal={{ type: 'time' }}
        isRequired
        value={clock}
        onChange={setClock}
        {...(tried && errors.time !== undefined ? { error: errors.time } : {})}
      />
      <Field
        label={strings.partySize}
        name="party-size"
        inputMode="numeric"
        isRequired
        value={partyText}
        onChange={setPartyText}
        onSubmit={create}
        {...(errors.party !== undefined && (tried || partyText !== '') ? { error: errors.party } : {})}
      />
      <Select
        label={strings.assignTable}
        labelAside={strings.optional}
        items={[
          { id: BEST, label: strings.bestTable },
          ...fitting.map((each) => {
            const area = areaOf(each.areaId);
            return {
              id: each.id,
              label: [each.label, strings.seatsShort(each.maxCapacity), ...(area === undefined ? [] : [area])].join(
                ' · ',
              ),
            };
          }),
        ]}
        value={shownTable}
        onChange={(next) => setTable(next ?? BEST)}
      />
      <Field
        label={strings.phone}
        labelAside={strings.optional}
        name="guest-phone"
        type="tel"
        autoComplete="off"
        maxLength={40}
        value={phone}
        onChange={setPhone}
      />
      <Field
        label={strings.email}
        labelAside={strings.optional}
        name="guest-email"
        type="email"
        autoComplete="off"
        hint={strings.emailHint}
        value={email}
        onChange={setEmail}
      />
      <Field
        label={strings.notes}
        placeholder={strings.notesPlaceholder}
        name="booking-notes"
        isMultiline
        maxLength={500}
        value={note}
        onChange={setNote}
      />
    </Modal>
  );
}

/** Where a booking came from, in the stand's words (checklabs' source pill). */
const sourceOf = (source: string) =>
  source === 'online' || source === 'desk' || source === 'walk_in' ? strings.source[source] : strings.source.other;

/**
 * A booking's detail (checklabs' sheet, in its order): the guest and status, when, Party size, Table, Source, Phone
 * (calls), Email (writes), the code, the occasion and the note; the moves the row offers at its foot.
 */
export function VisitSheet({
  visit,
  when,
  tableLabel,
  status,
  renderActions,
  onClose,
}: {
  readonly visit: ServiceVisit | undefined;
  readonly when: string;
  readonly tableLabel: string;
  readonly status: { readonly hue: Hue; readonly text: string };
  /** The row's moves, drawn as the Service list draws them (a callback, as a table cell is). */
  readonly renderActions: () => ReactNode;
  readonly onClose: () => void;
}) {
  const items: DescriptionItem[] =
    visit === undefined
      ? []
      : [
          { term: strings.when, description: when },
          { term: strings.partySize, description: strings.guestsCount(visit.party) },
          {
            term: strings.table,
            description: tableLabel === '' ? strings.noTable : tableLabel,
            isPlaceholder: tableLabel === '',
          },
          { term: strings.sourceTitle, description: sourceOf(visit.source) },
          ...(visit.phone === undefined
            ? []
            : [
                {
                  term: strings.phone,
                  description: <Link href={`tel:${visit.phone.replace(/[^\d+]/g, '')}`}>{visit.phone}</Link>,
                  copy: { value: visit.phone, label: strings.copyPhone },
                },
              ]),
          ...(visit.email === undefined
            ? []
            : [
                {
                  term: strings.email,
                  description: <Link href={`mailto:${visit.email}`}>{visit.email}</Link>,
                  copy: { value: visit.email, label: strings.copyEmail },
                },
              ]),
          { term: strings.code, description: visit.lookupCode },
          ...(visit.occasion === undefined
            ? []
            : [{ term: strings.occasionTitle, description: strings.occasion(visit.occasion) }]),
          ...(visit.note === undefined ? [] : [{ term: strings.note, description: visit.note }]),
        ];
  return (
    <Modal
      isOpen={visit !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={visit?.name ?? ''}
      icon="calendar-check"
      variant="drawer"
      status={<Badge dot={status.hue} text={status.text} />}
      actions={
        <>
          <Button slot="close">{strings.close}</Button>
          {visit === undefined ? null : renderActions()}
        </>
      }
    >
      <DescriptionList items={items} />
    </Modal>
  );
}

/** Statuses the day calendar leaves out (checklabs hides cancelled and no show blocks). */
export const OFF_CALENDAR: ReadonlySet<VisitStatus> = new Set(['cancelled', 'no_show']);
