// Brief
// Purpose: Availability's Time off card (spec 0037, AC-1286): the whole days a member is away, which close every page that books them, and the open schedule's own dates beside them (a day off in it, or some hours away), one row each, soonest first.
// Main task: see what is planned, Add time off in the card's head, open a row to change it, and delete one with its trash (gone at once, Undo in the toast; the simplicity sweep's rule 2, no confirm).
// Leaves out: a colleague's reason, note and stand in for someone who may only See them ("Away" and the days alone), and the Team week (Bookings › Roster).
import {
  isDataError,
  type BookingAvailability,
  type DataLayer,
  type DateOverride,
  type TimeOffEntry,
  type TimeOffSaved,
} from '@crm/data';
import { useScheduling } from '@crm/data/react';
import {
  Button,
  Card,
  Disclosure,
  EmptyState,
  focusLater,
  LinkList,
  Table,
  Tooltip,
  useFormatSettings,
  type LinkRow,
  type TableColumn,
} from '@crm/ui';
import { useRef, useState, type ReactNode } from 'react';
import { clockRangeOfMinutes, shortDay } from '../bookings/meeting-format.ts';
import type { DaysOffSlot } from './DaysOff.tsx';
import { awayOf, datesBetween, todayIn, upcomingOverrides, weeklyOn, withOverride } from './hours.ts';
import { firstName } from './time-off.ts';
import { timeOffStrings as strings } from './time-off-strings.ts';
import { TimeOffDialog, type StandinChoice } from './TimeOffDialog.tsx';

const COLUMNS: readonly TableColumn[] = [
  { id: 'days', label: strings.columns.days, isRowHeader: true },
  { id: 'what', label: strings.columns.what },
  { id: 'actions', label: strings.columns.actions, isLabelHidden: true, align: 'end' },
];

/** What the card says as a toast: a save, a delete with its Undo, or a refusal. */
export interface TimeOffNotice {
  readonly tone: 'success' | 'danger';
  readonly message: string;
  readonly action?: { readonly label: string; readonly onAction: () => void };
}

/** Props for the section. */
export interface TimeOffCardProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** Whose: undefined is the reader's own; a colleague by id and name. */
  readonly member: { readonly id: string; readonly name: string } | undefined;
  /** The reader's own member id ("Changed by you"). */
  readonly me: string;
  /** A member's name by id: stand ins and "Changed by". */
  readonly nameOf: (memberId: string) => string | undefined;
  /** Who may cover: the workspace's members. */
  readonly people: readonly StandinChoice[];
  /** A saved or deleted entry, as a toast (one at a time: the screen replaces the last); undefined takes it away. */
  readonly onNotice: (notice: TimeOffNotice | undefined) => void;
  /** Open Bookings (after a save over meetings). */
  readonly onOpenBookings: () => void;
  /**
   * The open schedule's own dates (Availability): listed beside the time off, and Some hours in the popup, saved at
   * once. Left out, the card holds time off alone.
   */
  readonly daysOff?: DaysOffSlot | undefined;
}

/** The section: a Card of rows, upcoming first, past ones folded under them, Add time off in its head. */
export function TimeOffCard(props: TimeOffCardProps) {
  const store = props.data.scheduling.loaded()?.timeOff;
  return store === undefined ? <TimeOffCardPending /> : <Loaded store={store} {...props} />;
}

type TimeOffStore = NonNullable<ReturnType<DataLayer['scheduling']['loaded']>>['timeOff'];

/** One row: whole days of time off, or a date of the open schedule. */
type Row =
  | { readonly kind: 'entry'; readonly id: string; readonly date: string; readonly entry: TimeOffEntry }
  | { readonly kind: 'date'; readonly id: string; readonly date: string; readonly override: DateOverride };

/** "Away 2:00 – 6:00 pm" for a date's own hours against its usual day ("Away all day" for none; its hours if more). */
function hoursWords(availability: BookingAvailability, override: DateOverride): string {
  if (override.ranges.length === 0) return strings.awayAllDay;
  const minutes = (time: string) => {
    const [hours = '0', mins = '0'] = time.split(':');
    return Number(hours) * 60 + Number(mins);
  };
  const words = (ranges: readonly (readonly [string, string])[]) =>
    ranges.map(([start, end]) => clockRangeOfMinutes(minutes(start), minutes(end))).join(', ');
  const { away, extra } = awayOf(weeklyOn(availability, override.date), override.ranges);
  return extra.length > 0 || away.length === 0
    ? strings.hoursOn(words(override.ranges))
    : strings.awayHours(words(away));
}

function Loaded({
  store,
  data,
  slug,
  member,
  me,
  nameOf,
  people,
  onNotice,
  onOpenBookings,
  daysOff,
}: TimeOffCardProps & { readonly store: TimeOffStore }) {
  const { timeZone } = useFormatSettings();
  const held = store.held(slug, member?.id);
  const state = useScheduling(held);
  const [isAdding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TimeOffEntry | undefined>(undefined);
  const [editingDate, setEditingDate] = useState<DateOverride | undefined>(undefined);
  // Rows on their way out: drawn from here, folding away, until the list says they are gone.
  const [leaving, setLeaving] = useState<readonly Row[]>([]);
  const addRef = useRef<HTMLButtonElement>(null);
  if (state.status === 'loading') return <TimeOffCardPending />;
  if (state.status === 'error') {
    return (
      <Card title={strings.title}>
        <EmptyState layout="row" tone="error" title={strings.failed} onRetry={() => held.reload()}>
          {state.error.message}
        </EmptyState>
      </Card>
    );
  }
  const { list } = state;
  const today = todayIn(daysOff?.availability.timeZone ?? timeZone);
  const dates = (from: string, to: string) =>
    from === to ? shortDay(from, today) : `${shortDay(from, today)} – ${shortDay(to, today)}`;
  const entryWords = (entry: TimeOffEntry) => {
    // See only: "Away" alone (AC-1286).
    if (entry.reason === undefined) return strings.away;
    const standin = entry.standinMemberId === undefined ? undefined : nameOf(entry.standinMemberId);
    const by =
      entry.changedBy === undefined
        ? undefined
        : entry.changedBy.memberId === me
          ? strings.you
          : (nameOf(entry.changedBy.memberId) ?? strings.someone);
    return [
      strings.awayAllDay,
      // "Other" says nothing a note doesn't.
      ...(entry.reason === 'other' ? [] : [strings.reasons[entry.reason]]),
      ...(entry.note === undefined || entry.note === '' ? [] : [entry.note]),
      ...(standin === undefined ? [] : [strings.covers(firstName(standin))]),
      // Someone else's change only: "Changed by you" on one's own rows is noise.
      ...(by === undefined || by === strings.you ? [] : [strings.changedBy(by)]),
    ].join(' · ');
  };
  const canChangeDates = daysOff !== undefined && daysOff.isReadOnly !== true;
  const canAdd = list.canManage || canChangeDates;
  const live: readonly Row[] = [
    ...list.upcoming.map((entry): Row => ({ kind: 'entry', id: entry.id, date: entry.fromDate, entry })),
    ...(daysOff === undefined
      ? []
      : upcomingOverrides(daysOff.availability, today).map((override): Row => ({
          kind: 'date',
          id: `date:${override.date}`,
          date: override.date,
          override,
        }))),
  ];
  const leavingIds = new Set(leaving.map((row) => row.id));
  const rows = [...live.filter((row) => !leavingIds.has(row.id)), ...leaving].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
  const titleOf = (row: Row) =>
    row.kind === 'entry' ? dates(row.entry.fromDate, row.entry.toDate) : shortDay(row.date, today);
  const detailOf = (row: Row) => {
    if (row.kind === 'entry') return entryWords(row.entry);
    const note = row.override.note;
    const hours = daysOff === undefined ? strings.awayAllDay : hoursWords(daysOff.availability, row.override);
    return note === undefined || note === '' ? hours : `${hours} · ${note}`;
  };
  const canChange = (row: Row) => (row.kind === 'entry' ? list.canManage : canChangeDates);
  const say = (message: string, undo?: () => void) =>
    onNotice({
      tone: 'success',
      message,
      ...(undo === undefined ? {} : { action: { label: strings.undo, onAction: undo } }),
    });
  const restoreEntry = (entry: TimeOffEntry) => {
    if (entry.reason === undefined) return;
    void store
      .create(slug, {
        id: store.newId(),
        ...(member === undefined ? {} : { memberId: member.id }),
        fromDate: entry.fromDate,
        toDate: entry.toDate,
        reason: entry.reason,
        ...(entry.note === undefined ? {} : { note: entry.note }),
        ...(entry.standinMemberId === undefined ? {} : { standinMemberId: entry.standinMemberId }),
      })
      .then(
        () => say(strings.restored),
        (error: unknown) =>
          onNotice({
            tone: 'danger',
            message: `${strings.restoreFailed} ${isDataError(error) ? error.message : ''}`.trim(),
          }),
      );
  };
  const stopLeaving = (id: string) => setLeaving((all) => all.filter((each) => each.id !== id));
  const remove = (row: Row, isPast = false) => {
    // An upcoming row folds away where it stood; a past one simply goes (the store takes it out at once).
    if (!isPast) setLeaving((all) => [...all, row]);
    // The row goes with its button: focus lands on Add time off, which always stays.
    focusLater(() => addRef.current);
    if (row.kind === 'entry') {
      const removal = store.remove(slug, row.entry);
      // Undo waits for the delete: a refused one is back already, so nothing is made twice.
      say(strings.deleted, () => void removal.then((landed) => (landed ? restoreEntry(row.entry) : undefined)));
      void removal.then((landed) => {
        if (landed) return;
        // Refused: the store put the row back and says why; the Deleted toast goes.
        stopLeaving(row.id);
        onNotice(undefined);
      });
      return;
    }
    const was = row.override;
    const commit = daysOff?.onCommit;
    if (commit === undefined) return;
    const removal = commit((current) => withOverride(current, was.date, undefined));
    say(
      strings.deleted,
      () =>
        void removal.then((landed) =>
          landed
            ? commit((current) => withOverride(current, was.date, was)).then((back) => {
                if (back) say(strings.restored);
              })
            : undefined,
        ),
    );
    // Refused: the commit's own toast says why, in the Deleted toast's place, and the row stays.
    void removal.then((landed) => {
      if (!landed) stopLeaving(row.id);
    });
  };
  const linkRow = (row: Row): LinkRow => {
    const title = titleOf(row);
    return {
      id: row.id,
      title,
      address: detailOf(row),
      chips: [],
      ...(leavingIds.has(row.id) ? { isLeaving: true } : {}),
      ...(canChange(row)
        ? {
            actions: (
              <Tooltip content={strings.deleteAction}>
                <Button
                  variant="ghost-danger"
                  icon="trash"
                  label={strings.deleteFor(title)}
                  onPress={() => remove(row)}
                />
              </Tooltip>
            ),
          }
        : {}),
    };
  };
  const open = (id: string) => {
    const row = rows.find((each) => each.id === id);
    if (row === undefined || !canChange(row) || leavingIds.has(id)) return;
    if (row.kind === 'entry') setEditing(row.entry);
    else setEditingDate(row.override);
  };
  // Everyone may read; only someone who may change a row gets rows that open.
  const anyChangeable = rows.some(canChange);
  const upcoming: ReactNode =
    rows.length === 0 ? (
      <EmptyState layout="row" icon="plane" title={strings.none} />
    ) : anyChangeable ? (
      <LinkList
        label={strings.title}
        searchLabel={strings.title}
        density="compact"
        placement="card"
        isToolbarHidden
        hasRowMotion
        rows={rows.map(linkRow)}
        onOpen={open}
        onLeft={(id) => setLeaving((all) => all.filter((row) => row.id !== id))}
      />
    ) : (
      <Table
        label={strings.title}
        columns={COLUMNS.filter((column) => column.id !== 'actions')}
        rows={rows}
        isHeaderHidden
        getRowId={(row) => row.id}
        renderCell={(row, column) => (column === 'days' ? titleOf(row) : detailOf(row))}
      />
    );
  const who = member === undefined ? undefined : { id: member.id, name: member.name };
  const marked = live.flatMap((row) =>
    row.kind === 'date' ? [row.date] : datesBetween(row.entry.fromDate, row.entry.toDate),
  );
  const pastEntries = list.past.map((entry): Row => ({ kind: 'entry', id: entry.id, date: entry.fromDate, entry }));
  return (
    <Card
      title={strings.title}
      actions={
        canAdd ? (
          <Button ref={addRef} icon="plus" onPress={() => setAdding(true)}>
            {who === undefined ? strings.add : strings.addFor(firstName(who.name))}
          </Button>
        ) : undefined
      }
    >
      {upcoming}
      {pastEntries.length > 0 && (
        <Disclosure title={strings.past} count={pastEntries.length} variant="quiet">
          <Table
            label={strings.past}
            columns={list.canManage ? COLUMNS : COLUMNS.filter((column) => column.id !== 'actions')}
            rows={pastEntries}
            isHeaderHidden
            getRowId={(row) => row.id}
            renderCell={(row, column) =>
              column === 'days' ? (
                titleOf(row)
              ) : column === 'what' ? (
                detailOf(row)
              ) : (
                <Tooltip content={strings.deleteAction}>
                  <Button
                    variant="ghost-danger"
                    icon="trash"
                    label={strings.deleteFor(titleOf(row))}
                    onPress={() => remove(row, true)}
                  />
                </Tooltip>
              )
            }
          />
        </Disclosure>
      )}
      <TimeOffDialog
        data={data}
        slug={slug}
        member={who}
        entry={editing}
        override={editingDate}
        isOpen={isAdding || editing !== undefined || editingDate !== undefined}
        people={people.filter((person) => person.id !== list.memberId)}
        marked={marked}
        {...(canChangeDates && daysOff.onCommit !== undefined
          ? {
              hours: {
                availability: daysOff.availability,
                onCommit: daysOff.onCommit,
                scheduleName: daysOff.scheduleName ?? '',
              },
            }
          : {})}
        onClose={() => {
          setAdding(false);
          setEditing(undefined);
          setEditingDate(undefined);
        }}
        onSaved={(_saved: TimeOffSaved, isNew) => say(isNew ? strings.added : strings.changed)}
        onHoursSaved={(isNew) => say(isNew ? strings.added : strings.changed)}
        onOpenBookings={onOpenBookings}
      />
    </Card>
  );
}

/** The section while it loads, in its loaded anatomy: Add time off in its head, a row's place under it. */
export function TimeOffCardPending() {
  return (
    <Card
      title={strings.title}
      isBusy
      actions={
        <Button icon="plus" isDisabled>
          {strings.add}
        </Button>
      }
    >
      <EmptyState layout="row" isLoading title={strings.loading} />
    </Card>
  );
}
