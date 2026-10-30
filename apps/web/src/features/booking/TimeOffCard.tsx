// Brief
// Purpose: Availability's Time off section (spec 0037, AC-1286): the whole days a member is away, which close every page that books them.
// Main task: see what is planned and Add time off; each row's menu edits or deletes it (Delete asks first, AC-1445).
// Leaves out: a colleague's reason, note and stand in for someone who may only See them ("Away" and the days alone), and the Team week (a follow up).
import type { DataLayer, TimeOffEntry, TimeOffSaved } from '@crm/data';
import { useTimeOff } from '@crm/data/react';
import {
  Button,
  Card,
  Disclosure,
  EmptyState,
  focusLater,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  Table,
  useFormatSettings,
  type TableColumn,
} from '@crm/ui';
import { useRef, useState } from 'react';
import { daysLabel, firstName } from './time-off.ts';
import { timeOffStrings as strings } from './time-off-strings.ts';
import { TimeOffDialog, type StandinChoice } from './TimeOffDialog.tsx';

const COLUMNS: readonly TableColumn[] = [
  { id: 'days', label: strings.columns.days, isRowHeader: true },
  { id: 'what', label: strings.columns.what },
  { id: 'actions', label: strings.columns.actions, isLabelHidden: true, align: 'end' },
];

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
  /** A saved or deleted entry, as a toast. */
  readonly onNotice: (notice: { readonly tone: 'success' | 'danger'; readonly message: string }) => void;
  /** Open Bookings (after a save over meetings). */
  readonly onOpenBookings: () => void;
}

/** The section: a Card of rows, upcoming first, past ones folded under them, then Add time off. */
export function TimeOffCard({ data, slug, member, me, nameOf, people, onNotice, onOpenBookings }: TimeOffCardProps) {
  const store = data.scheduling.loaded()?.timeOff;
  return store === undefined ? (
    <TimeOffCardPending />
  ) : (
    <Loaded
      store={store}
      data={data}
      slug={slug}
      member={member}
      me={me}
      nameOf={nameOf}
      people={people}
      onNotice={onNotice}
      onOpenBookings={onOpenBookings}
    />
  );
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
}: TimeOffCardProps & { readonly store: NonNullable<ReturnType<DataLayer['scheduling']['loaded']>>['timeOff'] }) {
  const { locale, timeZone } = useFormatSettings();
  const held = store.held(slug, member?.id);
  const state = useTimeOff(held);
  const [isAdding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TimeOffEntry | undefined>(undefined);
  const [deleting, setDeleting] = useState<TimeOffEntry | undefined>(undefined);
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
  const thisYear = Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone }).format(new Date()));
  const days = (entry: TimeOffEntry) => daysLabel(entry.fromDate, entry.toDate, locale, thisYear);
  const others = people.filter((person) => person.id !== list.memberId);
  const what = (entry: TimeOffEntry) => {
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
      strings.reasons[entry.reason],
      ...(standin === undefined ? [] : [strings.covers(firstName(standin))]),
      ...(entry.note === undefined ? [] : [entry.note]),
      ...(by === undefined ? [] : [strings.changedBy(by)]),
    ].join(' · ');
  };
  const columns = list.canManage ? COLUMNS : COLUMNS.filter((column) => column.id !== 'actions');
  const table = (entries: readonly TimeOffEntry[], label: string) => (
    <Table
      label={label}
      columns={columns}
      rows={entries}
      isHeaderHidden
      getRowId={(entry) => entry.id}
      renderCell={(entry, column) =>
        column === 'days' ? (
          days(entry)
        ) : column === 'what' ? (
          what(entry)
        ) : (
          <MenuTrigger>
            <Button variant="ghost" icon="ellipsis" label={strings.actionsFor(days(entry))} />
            <Menu
              label={strings.actionsFor(days(entry))}
              onAction={(key) => {
                if (key === 'edit') setEditing(entry);
                else if (key === 'delete') setDeleting(entry);
              }}
            >
              <MenuItem id="edit" icon="pencil">
                {strings.editAction}
              </MenuItem>
              <MenuItem id="delete" icon="trash" isDanger>
                {strings.deleteAction}
              </MenuItem>
            </Menu>
          </MenuTrigger>
        )
      }
    />
  );
  const who = member === undefined ? undefined : { id: member.id, name: member.name };
  return (
    <Card title={strings.title}>
      {list.upcoming.length === 0 ? (
        <EmptyState layout="row" icon="plane" title={strings.none} />
      ) : (
        table(list.upcoming, strings.title)
      )}
      {list.past.length > 0 && (
        <Disclosure title={strings.past} count={list.past.length} variant="quiet">
          {table(list.past, strings.past)}
        </Disclosure>
      )}
      {list.canManage && (
        <Button ref={addRef} icon="plus" onPress={() => setAdding(true)}>
          {who === undefined ? strings.add : strings.addFor(firstName(who.name))}
        </Button>
      )}
      <TimeOffDialog
        data={data}
        slug={slug}
        member={who}
        entry={editing}
        isOpen={isAdding || editing !== undefined}
        people={others}
        onClose={() => {
          setAdding(false);
          setEditing(undefined);
          focusLater(() => addRef.current);
        }}
        onSaved={(_saved: TimeOffSaved, isNew) =>
          onNotice({ tone: 'success', message: isNew ? strings.added : strings.changed })
        }
        onOpenBookings={onOpenBookings}
      />
      <DeleteTimeOff
        entry={deleting}
        days={deleting === undefined ? '' : days(deleting)}
        member={who}
        onClose={() => {
          setDeleting(undefined);
          focusLater(() => addRef.current);
        }}
        onDelete={(entry) => {
          setDeleting(undefined);
          focusLater(() => addRef.current);
          // Gone at once; put back with a toast by the store if refused.
          void store.remove(slug, entry).then((landed) => {
            if (landed) onNotice({ tone: 'success', message: strings.deleted });
          });
        }}
      />
    </Card>
  );
}

/** "Delete time off, 3 to 7 Nov?": a danger Modal, Cancel (ESC), then Delete time off (AC-1445). */
function DeleteTimeOff({
  entry,
  days,
  member,
  onClose,
  onDelete,
}: {
  readonly entry: TimeOffEntry | undefined;
  readonly days: string;
  readonly member: { readonly name: string } | undefined;
  readonly onClose: () => void;
  readonly onDelete: (entry: TimeOffEntry) => void;
}) {
  // The last entry stays while the Modal plays its exit.
  const [last, setLast] = useState(entry);
  const [lastDays, setLastDays] = useState(days);
  if (entry !== undefined && entry !== last) {
    setLast(entry);
    setLastDays(days);
  }
  const shown = entry ?? last;
  if (shown === undefined) return null;
  return (
    <Modal
      title={strings.deleteTitle(lastDays)}
      tone="danger"
      isOpen={entry !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      actions={
        <>
          <Button slot="close" kbd="ESC">
            {strings.cancel}
          </Button>
          <Button variant="danger-solid" icon="trash" onPress={() => onDelete(shown)}>
            {strings.deleteCommit}
          </Button>
        </>
      }
    >
      {member === undefined ? strings.deleteBody : strings.deleteBodyFor(firstName(member.name))}
    </Modal>
  );
}

/** The section while it loads, in its loaded anatomy: a row's place, then Add time off under it. */
export function TimeOffCardPending() {
  return (
    <Card title={strings.title} isBusy>
      <EmptyState layout="row" isLoading title={strings.loading} />
      <Button icon="plus" isDisabled>
        {strings.add}
      </Button>
    </Card>
  );
}
