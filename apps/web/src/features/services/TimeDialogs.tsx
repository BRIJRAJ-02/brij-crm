// Brief
// Purpose: time off and blocked time for a staff member who doesn't sign in (spec 0066 B1, AC-6612): a holiday over
// days, or a lunch on one day, both busy for online booking. Shared by the profile and the Shifts grid.
// Main task: pick the days (or the day and the hours) and add it.
// Leaves out: a linked member's time off (theirs is in their own Availability, one source) and repeating blocks.
import type { ServicePlace, StaffView } from '@crm/data';
import { CATALOGUE_LIMITS } from '@crm/data/services';
import { wallToInstant } from '@crm/data/menu';
import { Button, Callout, DatePicker, Field, Form, FormRow, Modal, Select, type SelectItem } from '@crm/ui';
import { useId, useState } from 'react';
import { clockLabel } from '../hospitality/hours-rows.ts';
import { plusDays } from './shifts.ts';
import { strings } from './strings.ts';

const REASONS = ['holiday', 'sick', 'training', 'other'] as const;
type Reason = (typeof REASONS)[number];

/** Every quarter hour of the day, as the Select lists it. */
const quarterItems = (locale: string): readonly SelectItem[] =>
  Array.from({ length: 96 }, (_, index) => {
    const time = `${String(Math.floor(index / 4)).padStart(2, '0')}:${String((index % 4) * 15).padStart(2, '0')}`;
    return { id: time, label: clockLabel(time, locale) };
  });

const minutesOf = (time: string) => {
  const [h = 0, m = 0] = time.split(':').map(Number);
  return h * 60 + m;
};

/** Adds time off: whole days from one date to another, at one place or every place they work. */
export function TimeOffDialog({
  person,
  places,
  today,
  onClose,
  onAdd,
}: {
  readonly person: StaffView;
  readonly places: readonly ServicePlace[];
  readonly today: string;
  readonly onClose: () => void;
  readonly onAdd: (input: {
    readonly start: string;
    readonly end: string;
    readonly reason: Reason;
    readonly placeId?: string;
  }) => Promise<string | undefined>;
}) {
  const formId = useId();
  const theirs = places.filter((place) => person.places.some((at) => at.placeId === place.id));
  const [from, setFrom] = useState<string | null>(today);
  const [until, setUntil] = useState<string | null>(today);
  const [reason, setReason] = useState<Reason>('holiday');
  const [placeId, setPlaceId] = useState<string>('');
  const [isSaving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const order = from !== null && until !== null && until < from ? strings.endAfterStart : undefined;
  // Whole days on the place's own clock (the first of theirs when it is every place).
  const zone = (theirs.find((place) => place.id === placeId) ?? theirs[0])?.timeZone ?? 'UTC';
  const canAdd = from !== null && until !== null && order === undefined;
  return (
    <Modal
      variant="form"
      title={strings.timeOffTitle(person.name)}
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      actions={
        <>
          <Button slot="close">{strings.cancel}</Button>
          <Button variant="primary" type="submit" form={formId} isPending={isSaving} isDisabled={!canAdd}>
            {strings.add}
          </Button>
        </>
      }
    >
      <Form
        id={formId}
        isBusy={isSaving}
        isDisabled={!canAdd}
        onSubmit={() => {
          if (from === null || until === null || order !== undefined) return;
          setSaving(true);
          void onAdd({
            start: wallToInstant(from, 0, zone).toISOString(),
            end: wallToInstant(plusDays(until, 1), 0, zone).toISOString(),
            reason,
            ...(placeId === '' ? {} : { placeId }),
          }).then((refused) => {
            setSaving(false);
            setError(refused);
          });
        }}
      >
        <FormRow>
          <DatePicker label={strings.from} value={from} onChange={setFrom} isRequired />
          <DatePicker
            label={strings.until}
            value={until}
            onChange={setUntil}
            isRequired
            {...(order === undefined ? {} : { error: order })}
          />
        </FormRow>
        <Select
          label={strings.reason}
          items={REASONS.map((each) => ({ id: each, label: strings.reasons[each] }))}
          value={reason}
          onChange={(chosen) => setReason((chosen ?? 'holiday') as Reason)}
        />
        {theirs.length > 1 ? (
          <Select
            label={strings.place}
            items={[
              { id: '', label: strings.allPlaces },
              ...theirs.map((place) => ({ id: place.id, label: strings.onlyHere(place.name) })),
            ]}
            value={placeId}
            onChange={(chosen) => setPlaceId(chosen ?? '')}
          />
        ) : null}
        {error === undefined ? null : <Callout tone="danger">{error}</Callout>}
      </Form>
    </Modal>
  );
}

/** Blocks time on one day at one place (lunch, training). */
export function BlockDialog({
  person,
  place,
  day,
  locale,
  onClose,
  onAdd,
}: {
  readonly person: StaffView;
  readonly place: ServicePlace;
  readonly day: string;
  readonly locale: string;
  readonly onClose: () => void;
  readonly onAdd: (input: {
    readonly start: string;
    readonly end: string;
    readonly reason?: string;
  }) => Promise<string | undefined>;
}) {
  const formId = useId();
  const [date, setDate] = useState<string | null>(day);
  const [from, setFrom] = useState('13:00');
  const [to, setTo] = useState('14:00');
  const [reason, setReason] = useState('');
  const [isSaving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const items = quarterItems(locale);
  const order = minutesOf(to) <= minutesOf(from) ? strings.endAfterStart : undefined;
  const canAdd = date !== null && order === undefined;
  return (
    <Modal
      variant="form"
      title={strings.blockTitle(person.name)}
      context={place.name}
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      actions={
        <>
          <Button slot="close">{strings.cancel}</Button>
          <Button variant="primary" type="submit" form={formId} isPending={isSaving} isDisabled={!canAdd}>
            {strings.add}
          </Button>
        </>
      }
    >
      <Form
        id={formId}
        isBusy={isSaving}
        isDisabled={!canAdd}
        onSubmit={() => {
          if (date === null || order !== undefined) return;
          setSaving(true);
          void onAdd({
            start: wallToInstant(date, minutesOf(from), place.timeZone).toISOString(),
            end: wallToInstant(date, minutesOf(to), place.timeZone).toISOString(),
            ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
          }).then((refused) => {
            setSaving(false);
            setError(refused);
          });
        }}
      >
        <DatePicker label={strings.blockDay} value={date} onChange={setDate} isRequired />
        <FormRow>
          <Select
            variant="time"
            label={strings.blockFrom}
            items={items}
            value={from}
            onChange={(chosen) => setFrom(chosen ?? from)}
          />
          <Select
            variant="time"
            label={strings.blockTo}
            items={items}
            value={to}
            onChange={(chosen) => setTo(chosen ?? to)}
            {...(order === undefined ? {} : { error: order })}
          />
        </FormRow>
        <Field
          label={strings.blockReason}
          value={reason}
          onChange={setReason}
          placeholder={strings.blockReasonHint}
          maxLength={CATALOGUE_LIMITS.blockReasonMax}
          {...(error === undefined ? {} : { error })}
        />
      </Form>
    </Modal>
  );
}
