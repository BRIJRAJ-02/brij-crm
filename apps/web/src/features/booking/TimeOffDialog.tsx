// Brief
// Purpose: Add or edit time off (spec 0037, AC-1281, AC-1285, AC-1286): whole days away, for the reader or a colleague they manage.
// Main task: pick the days, a reason, optionally who covers and a note, then Save; when meetings are already booked inside, the dialog lists them before it closes.
// Leaves out: part days (Block time on the Bookings week), repeating leave, and moving the meetings inside (they stay; Bookings flags them Host away).
import { isDataError, type DataLayer, type TimeOffEntry, type TimeOffReason, type TimeOffSaved } from '@crm/data';
import {
  Avatar,
  Button,
  Callout,
  DateRangePicker,
  DescriptionList,
  Field,
  Modal,
  Select,
  useFormatSettings,
} from '@crm/ui';
import { useState } from 'react';
import { firstName } from './time-off.ts';
import { timeOffStrings as strings } from './time-off-strings.ts';

const REASONS: readonly TimeOffReason[] = ['vacation', 'sick', 'travel', 'holiday', 'other'];
const NOBODY = 'nobody';
const NOTE_MAX = 200;

/** Someone who could cover. */
export interface StandinChoice {
  readonly id: string;
  readonly name: string;
  readonly avatarUrl?: string | undefined;
}

/** Props for the dialog. */
export interface TimeOffDialogProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** Whose time off: undefined is the reader's own. */
  readonly member: { readonly id: string; readonly name: string } | undefined;
  /** The entry to change; undefined adds one. */
  readonly entry: TimeOffEntry | undefined;
  readonly isOpen: boolean;
  /** Who may cover: active members other than the one away. */
  readonly people: readonly StandinChoice[];
  readonly onClose: () => void;
  /** Saved: the screen says so. */
  readonly onSaved: (saved: TimeOffSaved, isNew: boolean) => void;
  /** Open Bookings, from the meetings inside. */
  readonly onOpenBookings: () => void;
}

/** The dialog: one Modal, the form first, then (only when meetings are inside) what was saved over. */
export function TimeOffDialog(props: TimeOffDialogProps) {
  // Each opening starts afresh: a new id for a new entry, the entry's own fields for an edit.
  const [opening, setOpening] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.isOpen);
  if (props.isOpen !== wasOpen) {
    setWasOpen(props.isOpen);
    if (props.isOpen) setOpening((count) => count + 1);
  }
  return <TimeOffForm key={opening} {...props} />;
}

function TimeOffForm({
  data,
  slug,
  member,
  entry,
  isOpen,
  people,
  onClose,
  onSaved,
  onOpenBookings,
}: TimeOffDialogProps) {
  const { locale, timeZone } = useFormatSettings();
  const store = data.scheduling.loaded()?.timeOff;
  const [id] = useState(() => store?.newId() ?? '');
  const [range, setRange] = useState<{ readonly start: string; readonly end: string } | null>(
    entry === undefined ? null : { start: entry.fromDate, end: entry.toDate },
  );
  const [reason, setReason] = useState<TimeOffReason>(entry?.reason ?? 'vacation');
  const [standin, setStandin] = useState<string>(entry?.standinMemberId ?? NOBODY);
  const [note, setNote] = useState(entry?.note ?? '');
  const [isBusy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ readonly days?: string; readonly standin?: string; readonly form?: string }>(
    {},
  );
  const [saved, setSaved] = useState<TimeOffSaved | undefined>(undefined);
  const first = member === undefined ? undefined : firstName(member.name);
  const title =
    entry === undefined
      ? first === undefined
        ? strings.add
        : strings.addFor(first)
      : first === undefined
        ? strings.edit
        : strings.editFor(first);
  const close = () => {
    if (isBusy) return;
    if (saved !== undefined) onSaved(saved, entry === undefined);
    onClose();
  };
  const save = () => {
    if (isBusy || store === undefined) return;
    if (range === null) {
      setErrors({ days: strings.pickDays });
      return;
    }
    setBusy(true);
    setErrors({});
    const draft = {
      fromDate: range.start,
      toDate: range.end,
      reason,
      note,
      ...(standin === NOBODY ? {} : { standinMemberId: standin }),
    };
    const sent =
      entry === undefined
        ? store.create(slug, { id, ...(member === undefined ? {} : { memberId: member.id }), ...draft })
        : store.update(slug, entry, draft);
    sent.then(
      (answer) => {
        setBusy(false);
        // Nothing inside: done. Meetings inside: the dialog lists them before it closes (AC-1285).
        if (answer.bookingsInside.length === 0) {
          onSaved(answer, entry === undefined);
          onClose();
        } else setSaved(answer);
      },
      (error: unknown) => {
        setBusy(false);
        const message = isDataError(error) ? error.message : strings.somethingWrong;
        const field = isDataError(error) ? error.data?.refusals?.[0]?.field : undefined;
        if (field === 'toDate' || field === 'fromDate') setErrors({ days: message });
        else if (field === 'standinMemberId') setErrors({ standin: message });
        else setErrors({ form: message });
      },
    );
  };
  if (saved !== undefined) {
    const count = saved.bookingsInside.length + saved.moreInside;
    return (
      <Modal
        title={strings.insideTitle}
        icon="calendar"
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        actions={
          <>
            <Button
              onPress={() => {
                close();
                onOpenBookings();
              }}
            >
              {strings.openBookings}
            </Button>
            <Button variant="primary" onPress={close}>
              {strings.done}
            </Button>
          </>
        }
      >
        <Callout tone="warning" title={first === undefined ? strings.inside(count) : strings.insideFor(first, count)}>
          {strings.insideKept}
        </Callout>
        <DescriptionList
          layout="compact"
          items={saved.bookingsInside.map((booking) => ({
            id: booking.id,
            term: when(booking.startsAt, locale, timeZone),
            description: `${booking.visitorName} · ${booking.pageTitle}`,
          }))}
        />
        {saved.moreInside > 0 && <p>{strings.insideMore(saved.moreInside)}</p>}
      </Modal>
    );
  }
  return (
    <Modal
      title={title}
      isOpen={isOpen}
      isBusy={isBusy}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy} kbd="ESC">
            {strings.cancel}
          </Button>
          <Button variant="primary" isPending={isBusy} onPress={save}>
            {isBusy ? strings.saving : strings.save}
          </Button>
        </>
      }
    >
      {errors.form !== undefined && <Callout tone="danger">{errors.form}</Callout>}
      <DateRangePicker
        label={strings.days}
        hint={first === undefined ? strings.daysHint : strings.daysHintFor(first)}
        value={range}
        isRequired
        onChange={(next) => {
          setRange(next);
          setErrors((was) => ({ ...was, days: undefined }));
        }}
        {...(errors.days === undefined ? {} : { error: errors.days })}
      />
      <Select
        label={strings.reason}
        items={REASONS.map((each) => ({ id: each, label: strings.reasons[each] }))}
        value={reason}
        onChange={(next) => {
          const found = REASONS.find((each) => each === next);
          if (found !== undefined) setReason(found);
        }}
      />
      <Select
        label={strings.standin}
        hint={first === undefined ? strings.standinHint : strings.standinHintFor(first)}
        isSearchable
        items={[
          { id: NOBODY, label: strings.nobody },
          ...people.map((person) => ({
            id: person.id,
            label: person.name,
            leading: (
              <Avatar
                name={person.name}
                id={person.id}
                size="xs"
                {...(person.avatarUrl === undefined ? {} : { src: person.avatarUrl })}
                isDecorative
              />
            ),
          })),
        ]}
        value={standin}
        onChange={(next) => {
          setStandin(next ?? NOBODY);
          setErrors((was) => ({ ...was, standin: undefined }));
        }}
        {...(errors.standin === undefined ? {} : { error: errors.standin })}
      />
      <Field
        label={strings.note}
        hint={strings.noteHint}
        isMultiline
        maxLength={NOTE_MAX}
        showCounter
        value={note}
        onChange={setNote}
      />
    </Modal>
  );
}

/** "Tue 3 Nov, 9:00" in the reader's locale and zone. */
function when(at: string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(at));
}
