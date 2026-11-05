// Brief
// Purpose: the Reservations page's two booking sheets after checklabs' page: New booking (a reservation the host
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
  ChoiceChips,
  DatePicker,
  DescriptionList,
  Field,
  FormRow,
  Link,
  Modal,
  Select,
  type DescriptionItem,
  type Hue,
} from '@crm/ui';
import { useRef, useState, type ReactNode } from 'react';
import { instantAt } from '../bookings/week.ts';
import { strings } from './strings.ts';

/** The party a new booking starts with (checklabs' default). */
const DEFAULT_PARTY = 2;

/** The largest party picked as a chip, as Walk in picks it; a larger one is typed. */
const CHIP_PARTY_MAX = 12;

/** The chip that opens the typed party. */
const MORE = 'more';

/** The time a new booking starts at when no time was picked on the calendar (checklabs' default). */
export const DEFAULT_BOOKING_MINUTE = 19 * 60;

/** The booking times offered, every quarter hour of the day. */
const STEP = 15;

/** The tables that seat a party alone (checklabs offers only tables that fit), in floor order. */
export const tablesFor = (tables: readonly Resource[], party: number) =>
  tables.filter((table) => !table.archived && table.minCapacity <= party && table.maxCapacity >= party);

/** Which id the table Select uses for the engine's pick. */
const BEST = 'best';

/**
 * New booking (checklabs' sheet, in its order): Guest name, Date and Time (the page's day, 19:00 or the time picked on
 * the calendar), Party size (2), Assign table (only tables that seat the party, else the best free one), Phone, Email
 * and Notes (optional). Cancel, then Create booking; a refusal (the time or table taken) says so and keeps the sheet.
 */
export function NewBookingDialog({
  slug,
  tables,
  placeId,
  zone,
  date,
  minute,
  now,
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
  /** The clock now, so a time already gone is refused before it is sent. */
  readonly now: number;
  readonly floorTables: readonly Resource[];
  readonly areas: readonly Area[];
  readonly onClose: () => void;
  readonly onBooked: (name: string, day: string) => void;
}) {
  const [name, setName] = useState('');
  const [day, setDay] = useState(date);
  const [at, setAt] = useState(minute - (minute % STEP));
  const [partyPick, setPartyPick] = useState(String(DEFAULT_PARTY));
  const [partyText, setPartyText] = useState('');
  const [table, setTable] = useState(BEST);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | undefined>();
  const [tried, setTried] = useState(false);
  const [isSaving, setSaving] = useState(false);
  // Read synchronously: two Enters in one frame both see the first send.
  const sending = useRef(false);
  const typed = partyPick === MORE;
  const party = typed ? (/^\d+$/.test(partyText) ? Number(partyText) : undefined) : Number(partyPick);
  const partyOk = party !== undefined && party >= 1 && party <= 100;
  const fitting = partyOk ? tablesFor(floorTables, party) : [];
  const areaOf = (id: string | undefined) => areas.find((area) => area.id === id)?.name;
  // A table picked for a party it no longer seats goes back to the best free one.
  const shownTable = table === BEST || fitting.some((each) => each.id === table) ? table : BEST;
  const start = instantAt(day, at, zone);
  const timeLabel = (each: number) =>
    new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
      new Date(2000, 0, 1, Math.floor(each / 60), each % 60),
    );
  const errors = {
    name: name.trim() === '' ? strings.bookNameRequired : undefined,
    time: start.getTime() < now ? strings.bookTimeGone : undefined,
    party: partyOk ? undefined : strings.bookPartyRange,
  };

  const create = () => {
    setTried(true);
    if (sending.current || Object.values(errors).some((each) => each !== undefined) || !partyOk) return;
    sending.current = true;
    setSaving(true);
    setProblem(undefined);
    void tables
      .book(slug, placeId, day, {
        start: start.toISOString(),
        party,
        name,
        phone,
        email,
        note,
        ...(shownTable === BEST ? {} : { resourceIds: [shownTable] }),
      })
      .then((refused) => {
        sending.current = false;
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
      {/* Date and Time side by side, as checklabs' sheet sets them. */}
      <FormRow>
        <DatePicker
          label={strings.bookDate}
          isRequired
          value={day}
          onChange={(next) => {
            if (next !== null) setDay(next);
          }}
        />
        <Select
          label={strings.bookTime}
          items={Array.from({ length: (24 * 60) / STEP }, (_, index) => ({
            id: String(index * STEP),
            label: timeLabel(index * STEP),
          }))}
          value={String(at)}
          onChange={(next) => {
            if (next !== null) setAt(Number(next));
          }}
          {...(tried && errors.time !== undefined ? { error: errors.time } : {})}
        />
      </FormRow>
      <ChoiceChips
        label={strings.partySize}
        tone="strong"
        isSingle
        choices={[
          ...Array.from({ length: CHIP_PARTY_MAX }, (_, index) => ({
            id: String(index + 1),
            label: String(index + 1),
          })),
          { id: MORE, label: strings.morePeople(CHIP_PARTY_MAX) },
        ]}
        selected={[partyPick]}
        onChange={(next) => {
          if (next[0] !== undefined) setPartyPick(next[0]);
        }}
      />
      {typed && (
        <Field
          label={strings.largerParty}
          name="party-size"
          inputMode="numeric"
          isRequired
          value={partyText}
          onChange={setPartyText}
          onSubmit={create}
          {...(errors.party !== undefined && (tried || partyText !== '') ? { error: errors.party } : {})}
        />
      )}
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
        labelAside={strings.optional}
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

/** Where a booking came from, in the stand's words (checklabs' source pill): Phone, Walk in or Online. */
export const sourceOf = (source: string) =>
  source === 'online' || source === 'desk' || source === 'walk_in' ? strings.source[source] : strings.source.other;

/**
 * A booking's detail (checklabs' sheet, in its order): the guest and status, when, Party size, Table, Source, Phone
 * (calls), Email (writes), the code, the occasion and the note; its moves as buttons at its foot. While it closes it
 * keeps showing the booking it held, so it never empties on its way out.
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
  /** The sheet's moves (the screen's, as the list's row draws its own). */
  readonly renderActions: () => ReactNode;
  readonly onClose: () => void;
}) {
  const [last, setLast] = useState<
    | {
        readonly visit: ServiceVisit;
        readonly when: string;
        readonly tableLabel: string;
        readonly status: { readonly hue: Hue; readonly text: string };
      }
    | undefined
  >();
  if (visit !== undefined && (last?.visit !== visit || last.when !== when || last.status.text !== status.text)) {
    setLast({ visit, when, tableLabel, status });
  }
  const shown = visit === undefined ? last : { visit, when, tableLabel, status };
  const items: DescriptionItem[] =
    shown === undefined
      ? []
      : [
          { term: strings.when, description: shown.when },
          { term: strings.partySize, description: strings.guestsCount(shown.visit.party) },
          {
            term: strings.table,
            description: shown.tableLabel === '' ? strings.noTable : shown.tableLabel,
            isPlaceholder: shown.tableLabel === '',
          },
          { term: strings.sourceTitle, description: sourceOf(shown.visit.source) },
          ...(shown.visit.phone === undefined
            ? []
            : [
                {
                  term: strings.phone,
                  description: (
                    <Link href={`tel:${shown.visit.phone.replace(/[^\d+]/g, '')}`}>{shown.visit.phone}</Link>
                  ),
                  copy: { value: shown.visit.phone, label: strings.copyPhone },
                },
              ]),
          ...(shown.visit.email === undefined
            ? []
            : [
                {
                  term: strings.email,
                  description: <Link href={`mailto:${shown.visit.email}`}>{shown.visit.email}</Link>,
                  copy: { value: shown.visit.email, label: strings.copyEmail },
                },
              ]),
          { term: strings.code, description: shown.visit.lookupCode },
          ...(shown.visit.occasion === undefined
            ? []
            : [{ term: strings.occasionTitle, description: strings.occasion(shown.visit.occasion) }]),
          ...(shown.visit.note === undefined ? [] : [{ term: strings.note, description: shown.visit.note }]),
        ];
  return (
    <Modal
      isOpen={visit !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={shown?.visit.name ?? ''}
      icon="calendar-check"
      variant="drawer"
      {...(shown === undefined ? {} : { status: <Badge dot={shown.status.hue} text={shown.status.text} /> })}
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
