// Brief
// Purpose: hand a booking whose host is away (spec 0037, AC-1284, AC-1285: "Host away") to someone who can take it, in one confirmed step.
// Main task: confirm Reassign; the away host's seat goes to their time off's stand in when they are in its round robin group, else to whoever is free then and next in it.
// Leaves out: picking a person (More › Reassign does that), moving the time (Reschedule), and fixed hosts (the page's Hosts card).
import { isDataError, type BookingAssignment, type BookingListItem, type RotationView } from '@crm/data';
import { Button, Callout, Modal, Skeleton } from '@crm/ui';
import { useEffect, useState } from 'react';
import { awayPick } from './away-pick.ts';
import type { HostBookingActions } from './BookingActions.tsx';
import { strings } from './strings.ts';

/** Props for the dialog. */
export interface AwayReassignDialogProps {
  readonly booking: BookingListItem;
  /** The booking's live seats: one ledger row per rotation. */
  readonly seats: readonly BookingAssignment[];
  readonly actions: HostBookingActions;
  readonly onClose: () => void;
  /** It went through: the detail reads its seats again. */
  readonly onReassigned: () => void;
}

/** The confirm, mounted fresh each time it opens. */
export function AwayReassignDialog({ booking, seats, actions, onClose, onReassigned }: AwayReassignDialogProps) {
  const [rotations, setRotations] = useState<readonly RotationView[] | 'loading' | 'failed'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  useEffect(() => {
    let isCurrent = true;
    actions.rotations().then(
      (list) => {
        if (isCurrent) setRotations(list);
      },
      () => {
        if (isCurrent) setRotations('failed');
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [actions]);
  // The away host's own seat; the first when the ledger names them on none.
  const seat = seats.find((each) => each.memberId === booking.hostMemberId) ?? seats[0];
  const rotation = typeof rotations === 'string' ? undefined : rotations.find((each) => each.id === seat?.rotationId);
  const pick = awayPick(booking.hostAwayStandinId, rotation, typeof rotations !== 'string');
  const host = seat?.memberName ?? booking.hostName;
  const group = seat?.rotationName ?? strings.theGroup;
  const text =
    pick.kind === 'standin'
      ? pick.name === undefined
        ? strings.awayStandinUnknown(host)
        : strings.awayToStandin(pick.name, host)
      : pick.standinOutside
        ? strings.awayStandinOutside(host, group)
        : strings.awayToNext(group);
  const reassign = () => {
    if (seat === undefined || busy || rotations === 'loading') return;
    setBusy(true);
    setError(undefined);
    const to =
      pick.kind === 'standin'
        ? { memberId: pick.memberId, ...(pick.name === undefined ? {} : { memberName: pick.name }) }
        : {};
    actions.reassign(booking.id, { rotationId: seat.rotationId, ...to }).then(
      (done) => {
        setBusy(false);
        if (!done.changed) {
          setError(strings.awayNotChanged(host, group));
          return;
        }
        // Named when the group's members say who took it: the stand in, or whoever was next.
        const taker = rotation?.members.find((each) => each.memberId === done.hostMemberId)?.name;
        actions.notify('success', taker === undefined ? strings.reassigned : strings.reassignedTo(taker));
        onReassigned();
      },
      (failure: unknown) => {
        setBusy(false);
        setError(isDataError(failure) && failure.message !== '' ? failure.message : strings.changeFailed);
      },
    );
  };
  return (
    <Modal
      title={strings.awayReassignTitle(booking.pageTitle, booking.visitorName)}
      isOpen
      isBusy={busy}
      onOpenChange={(isOpen) => {
        if (!isOpen && !busy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={busy} kbd="ESC">
            {strings.keepHost}
          </Button>
          <Button
            variant="primary"
            icon="users-round"
            isPending={busy}
            isDisabled={rotations === 'loading' || seat === undefined}
            onPress={reassign}
          >
            {busy ? strings.reassigning : strings.reassign}
          </Button>
        </>
      }
    >
      {error !== undefined && (
        <Callout tone="danger" isAnnounced>
          {error}
        </Callout>
      )}
      {rotations === 'failed' && <Callout tone="info">{strings.awayMembersFailed(group)}</Callout>}
      {rotations === 'loading' ? <Skeleton lines={2} /> : <p>{text}</p>}
    </Modal>
  );
}
