// Brief
// Purpose: seat a walk in from the Reservations page (spec 0066 B7 lite), in the right hand sheet checklabs adds a
//   walk in with: Guest name, then Party size (2), then what we add, the free tables that fit them now.
// Main task: Seat now in one press when the party is two and a table is free: the party is preselected, the best fit
//   picked (or the table it was opened from), and the name optional.
// Leaves out: checklabs' waitlist (quoted wait, Notify, Left): a walk in seats at once until the waitlist arrives in a
//   later phase.
import type { FreeTablesView, TablePlace, TablesStore } from '@crm/data';
import { isDataError } from '@crm/data';
import { Button, Callout, ChoiceChips, EmptyState, Field, Modal, Skeleton } from '@crm/ui';
import { useEffect, useState } from 'react';
import { strings } from './strings.ts';

/** The party a walk in starts with (checklabs' default). */
const DEFAULT_PARTY = 2;

/** The largest walk in the stand seats from the screen; a bigger party is a reservation. */
const WALK_IN_MAX = 12;

/**
 * A walk in on one sheet: the guest's name (optional), how many (two to start with), then the free tables that fit
 * them now (best fit first, as the engine allocates), then Seat now. The same engine and locks as a reservation; a
 * table taken meanwhile says so and the free tables read again.
 */
export function WalkInDrawer({
  isOpen = true,
  slug,
  tables,
  place,
  date,
  tableId,
  onClose,
  onSeated,
}: {
  /** Open; the screen keeps the sheet mounted while it closes, so it slides out. */
  readonly isOpen?: boolean;
  readonly slug: string;
  readonly tables: TablesStore;
  readonly place: TablePlace;
  readonly date: string;
  /** The table it was opened from, picked when it fits. */
  readonly tableId?: string;
  readonly onClose: () => void;
  readonly onSeated: (label: string, party: number) => void;
}) {
  const [party, setParty] = useState(DEFAULT_PARTY);
  const [round, setRound] = useState(0);
  const [free, setFree] = useState<
    | { readonly key: string; readonly status: 'ready'; readonly value: FreeTablesView }
    | { readonly key: string; readonly status: 'error'; readonly message: string }
    | undefined
  >();
  const [picked, setPicked] = useState<string | undefined>();
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | undefined>();
  const [isSeating, setSeating] = useState(false);
  const key = `${String(party)}|${String(round)}`;
  const shown = free?.key === key ? free : undefined;

  useEffect(() => {
    let current = true;
    const asked = `${String(party)}|${String(round)}`;
    tables.freeTables(slug, place.id, party).then(
      (value) => {
        if (!current) return;
        setFree({ key: asked, status: 'ready', value });
        // A walk in started from a table picks that table when it fits; else the best fit.
        const first =
          value.tables.find((each) => tableId !== undefined && each.resourceIds.includes(tableId)) ?? value.tables[0];
        setPicked(first === undefined ? undefined : first.resourceIds.join('+'));
      },
      (error: unknown) => {
        if (current)
          setFree({
            key: asked,
            status: 'error',
            message: isDataError(error) ? error.message : strings.offline,
          });
      },
    );
    return () => {
      current = false;
    };
  }, [tables, slug, place.id, party, round, tableId]);

  const choice =
    shown?.status === 'ready' ? shown.value.tables.find((each) => each.resourceIds.join('+') === picked) : undefined;

  const seat = () => {
    if (isSeating || choice === undefined) return;
    setSeating(true);
    setProblem(undefined);
    void tables
      .walkIn(slug, place.id, date, {
        party,
        resourceIds: choice.resourceIds,
        ...(name.trim() === '' ? {} : { name: name.trim() }),
      })
      .then((refused) => {
        setSeating(false);
        if (refused === undefined) {
          onSeated(choice.label, party);
          return;
        }
        setProblem(refused.message);
        // Taken meanwhile: the free tables read again, so the list never offers it twice.
        if (refused.code === 'SLOT_TAKEN') setRound((count) => count + 1);
      });
  };

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open && !isSeating) onClose();
      }}
      title={strings.walkInTitle}
      icon="user-plus"
      variant="drawer"
      // A name typed in is never thrown away by a click outside: only Cancel or Esc leave it.
      isDismissable={name.trim() === ''}
      isBusy={isSeating}
      actions={
        <>
          <Button slot="close" isDisabled={isSeating}>
            {strings.cancel}
          </Button>
          <Button variant="primary" icon="table" isDisabled={choice === undefined} isPending={isSeating} onPress={seat}>
            {isSeating ? strings.seating : strings.seatNow}
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
        label={strings.walkInName}
        labelAside={strings.optional}
        hint={strings.walkInNameHint}
        name="walk-in-name"
        autoComplete="off"
        maxLength={120}
        value={name}
        onChange={setName}
        onSubmit={seat}
      />
      <ChoiceChips
        label={strings.walkInParty}
        tone="strong"
        isSingle
        choices={Array.from({ length: WALK_IN_MAX }, (_, index) => ({
          id: String(index + 1),
          label: String(index + 1),
        }))}
        selected={[String(party)]}
        onChange={(next) => {
          const size = Number(next[0]);
          if (Number.isInteger(size) && size > 0) {
            setParty(size);
            setPicked(undefined);
            setProblem(undefined);
          }
        }}
      />
      {shown === undefined ? (
        <Skeleton shape="text" lines={2} />
      ) : shown.status === 'error' ? (
        <EmptyState
          icon="circle-alert"
          title={shown.message}
          layout="row"
          onRetry={() => setRound((count) => count + 1)}
        />
      ) : shown.value.tables.length === 0 ? (
        <Callout tone="warning" isAnnounced>
          {strings.walkInNone(party)}
        </Callout>
      ) : (
        <ChoiceChips
          label={strings.walkInTables}
          labelAside={strings.walkInHold(shown.value.holdMinutes)}
          tone="strong"
          isSingle
          choices={shown.value.tables.map((each) => ({
            id: each.resourceIds.join('+'),
            label: strings.freeTable(each.label, each.seats),
          }))}
          selected={picked === undefined ? [] : [picked]}
          onChange={(next) => setPicked(next[0])}
        />
      )}
    </Modal>
  );
}
