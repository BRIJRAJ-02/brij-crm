// Brief
// Purpose: Add or edit time off (spec 0037, AC-1281, AC-1285, AC-1286), as Cal.com's date overrides lay it out: the month beside the choices. All day is whole days away, for the reader or a colleague they manage (For, AC-1272); Some hours is hours away on the open schedule's dates ("Away from 2:00 pm to 6:00 pm", the simplicity sweep's finding 1).
// Main task: pick the days on the month, All day or Some hours, then (all day) a reason and who covers, a note, and Add time off; when meetings are already booked inside whole days, the dialog says how many before it closes (spec 0058, AC-15), with Open Bookings for the reader's own.
// Leaves out: repeating leave, part days for a colleague picked in For (their schedule isn't open here), and moving the meetings inside (they stay; Bookings flags them Host away).
import {
  isDataError,
  type BookingAvailability,
  type DataLayer,
  type DateOverride,
  type TimeOffEntry,
  type TimeOffReason,
  type TimeOffSaved,
} from '@crm/data';
import {
  Avatar,
  Button,
  Callout,
  DescriptionList,
  Field,
  FieldGroup,
  Form,
  FormRow,
  Modal,
  MonthRangeCalendar,
  SegmentedControl,
  Select,
  Sentence,
  useFormatSettings,
  type DateRange,
} from '@crm/ui';
import { useId, useState } from 'react';
import { clockOfMinute } from '../bookings/meeting-format.ts';
import {
  awayOf,
  datesBetween,
  hoursLessAway,
  todayIn,
  weeklyOn,
  withDayOff,
  withHoursAway,
  withOverride,
} from './hours.ts';
import { firstName } from './time-off.ts';
import { timeOffStrings as strings } from './time-off-strings.ts';

const REASONS: readonly TimeOffReason[] = ['vacation', 'sick', 'travel', 'holiday', 'other'];
const NOBODY = 'nobody';
const ME = 'me';
const NOTE_MAX = 200;
/** A date's own note is shorter (the schedule's override, 120). */
const HOURS_NOTE_MAX = 120;
/** A day in quarter hours: the times a schedule takes (AC-961). */
const QUARTERS = Array.from({ length: 97 }, (_, index) => index * 15);
const FROM_TIMES = QUARTERS.slice(0, -1).map((minute) => ({ id: String(minute), label: clockOfMinute(minute) }));
const TO_TIMES = QUARTERS.slice(1).map((minute) => ({ id: String(minute), label: clockOfMinute(minute) }));
/** A new Some hours starts on the afternoon, as the mock's (2:00 to 6:00 pm). */
const FIRST_AWAY = { from: 840, to: 1080 } as const;

/** Someone who could cover. */
export interface StandinChoice {
  readonly id: string;
  readonly name: string;
  readonly avatarUrl?: string | undefined;
}

/** The open schedule, for time off of some hours: its dates' own hours, saved at once. */
export interface TimeOffHours {
  /** The schedule's hours as shown: the week some hours are taken from. */
  readonly availability: BookingAvailability;
  /** Saves a change to its dates at once (not waiting for the week's Save); answers whether it was stored. */
  readonly onCommit: (next: (current: BookingAvailability) => BookingAvailability) => Promise<boolean>;
  /** The schedule's name: Some hours changes it alone. */
  readonly scheduleName: string;
}

/** Props for the dialog. */
export interface TimeOffDialogProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** Whose time off: undefined is the reader's own. */
  readonly member: { readonly id: string; readonly name: string } | undefined;
  /** The entry to change; undefined adds one (or edits `override`). */
  readonly entry: TimeOffEntry | undefined;
  /** A date of the open schedule with its own hours to change (some hours away, or a day off in it). */
  readonly override?: DateOverride | undefined;
  /** A new entry's first and last day to start on (the Team day's drawn day); absent, Days starts empty. */
  readonly initialDay?: string | undefined;
  readonly isOpen: boolean;
  /** Who may cover: active members other than the one away. */
  readonly people: readonly StandinChoice[];
  /**
   * The colleagues the reader Manages (spec 0037, AC-1272): with any, a new entry for the reader asks For whom, Me
   * first. Left out where the dialog already knows whose (a colleague's Availability, a Team day column).
   */
  readonly forPeople?: readonly StandinChoice[];
  /** The open schedule: with it, Some hours is offered. Left out (Bookings' week), time off is whole days. */
  readonly hours?: TimeOffHours | undefined;
  /** Days that already have time off, dotted on the month. */
  readonly marked?: readonly string[];
  readonly onClose: () => void;
  /** Saved: the screen says so. */
  readonly onSaved: (saved: TimeOffSaved, isNew: boolean) => void;
  /** Some hours saved on the schedule's dates: the screen says so. */
  readonly onHoursSaved?: (isNew: boolean) => void;
  /** Open Bookings, from the meetings inside; absent where the reader is on Bookings already. */
  readonly onOpenBookings?: () => void;
  /** The reader, left out of Who covers while the time off is their own (a For pick lists them). */
  readonly meId?: string | undefined;
}

/** The dialog: one Modal, the form first, then (only when meetings are inside) how many were saved over. */
export function TimeOffDialog(props: TimeOffDialogProps) {
  // Each opening starts afresh: a new id for a new entry, the entry's own fields for an edit.
  const [opening, setOpening] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.isOpen);
  // The entry stays while the Modal plays its exit, so an edit's title never flips to Add as it closes.
  const [entry, setEntry] = useState(props.entry);
  const [override, setOverride] = useState(props.override);
  if (props.isOpen !== wasOpen) {
    setWasOpen(props.isOpen);
    if (props.isOpen) {
      setOpening((count) => count + 1);
      setEntry(props.entry);
      setOverride(props.override);
    }
  }
  return (
    <TimeOffForm
      key={opening}
      {...props}
      entry={props.isOpen ? props.entry : entry}
      override={props.isOpen ? props.override : override}
    />
  );
}

/** One time away in Some hours, in minutes of the day. */
interface Away {
  readonly id: number;
  readonly from: number;
  readonly to: number;
}

const minutes = (time: string): number => {
  const [hours = '0', mins = '0'] = time.split(':');
  return Number(hours) * 60 + Number(mins);
};
const clock = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** What is wrong with the times away, or undefined: each ends after it starts, and none overlap. */
function awayProblem(away: readonly Away[]): string | undefined {
  if (away.some((each) => each.to <= each.from)) return strings.endAfterStart;
  const sorted = [...away].sort((a, b) => a.from - b.from);
  if (sorted.some((each, index) => index > 0 && each.from < (sorted[index - 1]?.to ?? 0))) return strings.overlap;
  return undefined;
}

function TimeOffForm({
  data,
  slug,
  member: given,
  entry,
  override,
  isOpen,
  people: everyone,
  forPeople = [],
  hours,
  marked = [],
  meId,
  onClose,
  onSaved,
  onHoursSaved,
  onOpenBookings,
  initialDay,
}: TimeOffDialogProps) {
  const { locale, timeZone } = useFormatSettings();
  // For whom (AC-1272): only a new entry for the reader, by someone who Manages others.
  const offersFor = given === undefined && entry === undefined && override === undefined && forPeople.length > 0;
  const [forId, setForId] = useState(ME);
  const member = given ?? (forId === ME ? undefined : forPeople.find((person) => person.id === forId));
  const away = member?.id ?? meId;
  const people = away === undefined ? everyone : everyone.filter((person) => person.id !== away);
  const store = data.scheduling.loaded()?.timeOff;
  const [id] = useState(() => store?.newId() ?? '');
  const [range, setRange] = useState<DateRange | null>(
    override !== undefined
      ? { start: override.date, end: override.date }
      : entry === undefined
        ? initialDay === undefined
          ? null
          : { start: initialDay, end: initialDay }
        : { start: entry.fromDate, end: entry.toDate },
  );
  // A whole days entry stays whole days; a schedule's date stays on the schedule, all day or some hours.
  const [mode, setMode] = useState<'all' | 'some'>(
    override !== undefined && override.ranges.length > 0 ? 'some' : 'all',
  );
  const [aways, setAways] = useState<readonly Away[]>(() => {
    if (override === undefined || hours === undefined || override.ranges.length === 0) {
      return [{ id: 0, ...FIRST_AWAY }];
    }
    const taken = awayOf(weeklyOn(hours.availability, override.date), override.ranges).away;
    return taken.length === 0
      ? [{ id: 0, ...FIRST_AWAY }]
      : taken.map(([start, end], index) => ({ id: index, from: minutes(start), to: minutes(end) }));
  });
  const [reason, setReason] = useState<TimeOffReason>(entry?.reason ?? 'vacation');
  const [standin, setStandin] = useState<string>(entry?.standinMemberId ?? NOBODY);
  const [note, setNote] = useState(entry?.note ?? override?.note ?? '');
  const [isBusy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{
    readonly days?: string;
    readonly standin?: string;
    readonly away?: string;
    readonly form?: string;
  }>({});
  const [saved, setSaved] = useState<TimeOffSaved | undefined>(undefined);
  const formId = useId();
  const first = member === undefined ? undefined : firstName(member.name);
  // Some hours is the open schedule's, so it is there for that schedule's person alone, never an entry's edit.
  const offersHours = hours !== undefined && entry === undefined && (forId === ME || given !== undefined);
  const isHours = override !== undefined || (offersHours && mode === 'some');
  const isNew = entry === undefined && override === undefined;
  const title = isNew
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
  const saveHours = (picked: DateRange) => {
    if (hours === undefined) return;
    const problem = mode === 'some' ? awayProblem(aways) : undefined;
    if (problem !== undefined) {
      setErrors({ away: problem });
      return;
    }
    const dates = datesBetween(picked.start, picked.end);
    const taken = aways.map((each): readonly [string, string] => [clock(each.from), clock(each.to)]);
    const replacing = override?.date;
    // Hours away that take nothing (a day with no hours, times outside them) would save a change that changes nothing.
    if (mode === 'some') {
      const takes = dates.some((date) => {
        const own = hours.availability.overrides.find((each) => each.date === date);
        const within = own === undefined || date === replacing ? weeklyOn(hours.availability, date) : own.ranges;
        return JSON.stringify(hoursLessAway(within, taken)) !== JSON.stringify(hoursLessAway(within, []));
      });
      if (!takes) {
        setErrors({ away: strings.notWorking });
        return;
      }
    }
    setBusy(true);
    setErrors({});
    void hours
      .onCommit((current) => {
        // An edit that moved its date lets the old one go first.
        const base =
          replacing !== undefined && !dates.includes(replacing) ? withOverride(current, replacing, undefined) : current;
        return mode === 'all'
          ? dates.reduce((next, date) => withDayOff(next, date, note.trim()), base)
          : withHoursAway(base, dates, taken, note, replacing);
      })
      .then((stored) => {
        setBusy(false);
        // Refused: said here, in the popup, as the whole days path says its refusals.
        if (!stored) {
          setErrors({ form: strings.hoursFailed });
          return;
        }
        onHoursSaved?.(isNew);
        onClose();
      });
  };
  const save = () => {
    if (isBusy) return;
    if (range === null) {
      setErrors({ days: strings.pickDays });
      return;
    }
    if (isHours) {
      saveHours(range);
      return;
    }
    if (store === undefined) return;
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
        title={first === undefined ? strings.savedTitle : strings.savedTitleFor(first)}
        icon="calendar"
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        actions={
          <>
            {/* Bookings opens the reader's own: for a colleague's time off it wouldn't show these meetings. */}
            {first === undefined && onOpenBookings !== undefined && (
              <Button
                onPress={() => {
                  close();
                  onOpenBookings();
                }}
              >
                {strings.openBookings}
              </Button>
            )}
            {/* Focus lands on the answer, not the title bar's close. */}
            {/* eslint-disable-next-line jsx-a11y-x/no-autofocus -- the dialog turns to this step, and Done answers it */}
            <Button variant="primary" autoFocus onPress={close}>
              {strings.done}
            </Button>
          </>
        }
      >
        {/* The count says once, here, and is announced as the dialog turns. */}
        <Callout
          tone="warning"
          isAnnounced
          title={first === undefined ? strings.inside(count) : strings.insideFor(first, count)}
        >
          {first !== undefined && saved.moreInside > 0
            ? `${strings.insideKept} ${strings.insideMore(saved.moreInside)}`
            : strings.insideKept}
        </Callout>
        {/* The reader's own meetings are a press away on Bookings; a colleague's aren't there, so they're listed here. */}
        {first !== undefined && (
          <DescriptionList
            layout="compact"
            items={saved.bookingsInside.map((booking) => ({
              id: booking.id,
              term: when(booking.startsAt, locale, timeZone),
              description: `${booking.visitorName} · ${booking.pageTitle}`,
            }))}
          />
        )}
      </Modal>
    );
  }
  const changeAway = (awayId: number, change: Partial<Omit<Away, 'id'>>) => {
    setAways((all) => all.map((each) => (each.id === awayId ? { ...each, ...change } : each)));
    setErrors((was) => ({ ...was, away: undefined }));
  };
  const today = todayIn(hours?.availability.timeZone ?? timeZone);
  return (
    <Modal
      title={title}
      variant="window"
      isOpen={isOpen}
      isBusy={isBusy}
      // A form: only Cancel or Esc throws away what was typed.
      isDismissable={false}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      // The days first, as Cal.com's date overrides put the month beside the hours.
      lead={
        <MonthRangeCalendar
          label={strings.days}
          value={range}
          minValue={today}
          marked={marked}
          markedLabel={strings.markedDay}
          {...(errors.days === undefined ? {} : { error: errors.days })}
          onChange={(next) => {
            setRange(next);
            setErrors((was) => ({ ...was, days: undefined }));
          }}
        />
      }
      actions={
        <>
          <Button slot="close" isDisabled={isBusy} kbd="ESC">
            {strings.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} isPending={isBusy}>
            {isBusy ? strings.saving : isNew ? strings.add : strings.save}
          </Button>
        </>
      }
    >
      {errors.form !== undefined && <Callout tone="danger">{errors.form}</Callout>}
      <Form id={formId} label={title} onSubmit={save}>
        {offersFor && (
          <Select
            label={strings.forLabel}
            isSearchable={forPeople.length > 8}
            items={[
              { id: ME, label: strings.forMe },
              ...forPeople.map((person) => ({
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
            value={forId}
            onChange={(next) => {
              const picked = next ?? ME;
              setForId(picked);
              // Nobody covers for themself, and a colleague's time off is whole days here.
              if (standin === picked) setStandin(NOBODY);
              if (picked !== ME) setMode('all');
            }}
          />
        )}
        {first !== undefined && !offersFor && (
          <Callout tone="info">{isNew ? strings.onBehalf(first) : strings.onBehalfEdit(first)}</Callout>
        )}
        {(offersHours || override !== undefined) && (
          <SegmentedControl
            label={strings.howLong}
            size="compact"
            segments={[
              { value: 'all', label: strings.allDay },
              { value: 'some', label: strings.someHours },
            ]}
            value={mode}
            onChange={(next) => {
              setMode(next === 'some' ? 'some' : 'all');
              setErrors((was) => ({ ...was, away: undefined }));
            }}
          />
        )}
        {isHours && mode === 'some' && (
          <FieldGroup
            label={strings.hoursAway}
            // Some hours changes the open schedule alone: said where the hours are.
            {...(hours === undefined ? {} : { hint: strings.scheduleOnly(hours.scheduleName) })}
            {...(errors.away === undefined ? {} : { error: errors.away })}
            isLive
          >
            {aways.map((each, index) => (
              <Sentence
                key={each.id}
                {...(aways.length > 1
                  ? {
                      end: (
                        <Button
                          variant="ghost-danger"
                          icon="trash"
                          label={strings.removeAway(index + 1)}
                          onPress={() => setAways((all) => all.filter((other) => other.id !== each.id))}
                        />
                      ),
                    }
                  : {})}
              >
                {strings.awayFrom}
                <Select
                  label={strings.awayFromLabel(index + 1)}
                  isLabelHidden
                  variant="time"
                  items={FROM_TIMES}
                  value={String(each.from)}
                  onChange={(next) => {
                    if (next !== null) changeAway(each.id, { from: Number(next) });
                  }}
                />
                {strings.to}
                <Select
                  label={strings.awayToLabel(index + 1)}
                  isLabelHidden
                  variant="time"
                  items={TO_TIMES}
                  value={String(each.to)}
                  onChange={(next) => {
                    if (next !== null) changeAway(each.id, { to: Number(next) });
                  }}
                />
              </Sentence>
            ))}
            <Button
              variant="ghost"
              icon="plus"
              onPress={() => {
                const last = aways.at(-1);
                const from = Math.min((last?.to ?? 480) + 60, 1380);
                setAways((all) => [
                  ...all,
                  { id: Math.max(0, ...all.map((other) => other.id)) + 1, from, to: Math.min(from + 60, 1440) },
                ]);
              }}
            >
              {strings.addAway}
            </Button>
          </FieldGroup>
        )}
        {!isHours && (
          <FormRow>
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
          </FormRow>
        )}
        <Field
          label={strings.note}
          labelAside={strings.optional}
          isMultiline={!isHours}
          maxLength={isHours ? HOURS_NOTE_MAX : NOTE_MAX}
          value={note}
          onChange={setNote}
        />
      </Form>
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
