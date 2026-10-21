// Brief
// Purpose: give one seat of an upcoming round robin booking to someone else (spec 0029, AC-748; spec 0037, AC-1337).
// Main task: pick the next in its rotation or a named member, then Reassign; the guest and both hosts are emailed.
// Leaves out: the time (Reschedule moves it), fixed hosts (the page's Hosts card), and who may manage whom (the server says).
import { isDataError, type BookingAssignment, type BookingListItem, type RotationView } from '@crm/data';
import { Button, Callout, Modal, Select, SettingsStack, type SelectItem } from '@crm/ui';
import { useEffect, useState } from 'react';
import type { HostBookingActions } from './BookingActions.tsx';
import { strings } from './strings.ts';

/** The "Next in rotation" choice's id. */
const NEXT = 'next';

/** Props for the dialog. */
export interface ReassignDialogProps {
  readonly booking: BookingListItem;
  /** The booking's live seats: one ledger row per rotation. */
  readonly seats: readonly BookingAssignment[];
  readonly actions: HostBookingActions;
  readonly onClose: () => void;
  /** It went through: the detail reads its seats again. */
  readonly onReassigned: () => void;
}

/** The dialog, mounted fresh each time it opens. */
export function ReassignDialog({ booking, seats, actions, onClose, onReassigned }: ReassignDialogProps) {
  const [seatId, setSeatId] = useState(seats[0]?.rotationId ?? '');
  const [to, setTo] = useState<string>(NEXT);
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
  const seat = seats.find((each) => each.rotationId === seatId) ?? seats[0];
  const rotation = typeof rotations === 'string' ? undefined : rotations.find((each) => each.id === seat?.rotationId);
  const people: SelectItem[] = [
    { id: NEXT, label: strings.nextInRotation, description: strings.nextInRotationHint },
    ...(rotation?.members ?? [])
      .filter((member) => member.isOn && member.memberId !== seat?.memberId)
      .map((member) => ({ id: member.memberId, label: member.name })),
  ];
  const reassign = () => {
    if (seat === undefined || busy) return;
    setBusy(true);
    setError(undefined);
    const named = rotation?.members.find((member) => member.memberId === to);
    const choice = to === NEXT ? {} : { memberId: to, ...(named === undefined ? {} : { memberName: named.name }) };
    actions.reassign(booking.id, { rotationId: seat.rotationId, ...choice }).then(
      () => {
        setBusy(false);
        actions.notify('success', strings.reassigned);
        onReassigned();
      },
      (failure: unknown) => {
        setBusy(false);
        setError(isDataError(failure) ? failure.message : strings.changeFailed);
      },
    );
  };
  return (
    <Modal
      title={strings.reassignTitle(booking.pageTitle, booking.visitorName)}
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
          <Button variant="primary" isPending={busy} onPress={reassign}>
            {busy ? strings.reassigning : strings.reassign}
          </Button>
        </>
      }
    >
      <SettingsStack>
        {error !== undefined && (
          <Callout tone="danger" isAnnounced>
            {error}
          </Callout>
        )}
        {seats.length > 1 && (
          <Select
            label={strings.seat}
            items={seats.map((each) => ({
              id: each.rotationId,
              label: each.rotationName,
              description: each.memberName,
            }))}
            value={seatId}
            onChange={(id) => {
              if (id !== null) {
                setSeatId(id);
                setTo(NEXT);
              }
            }}
          />
        )}
        {rotations === 'failed' && <Callout tone="warning">{strings.reassignNamesFailed}</Callout>}
        <Select
          label={strings.newHost}
          hint={seat === undefined ? undefined : strings.nowWith(seat.memberName, seat.rotationName)}
          items={people}
          value={to}
          isDisabled={rotations === 'loading'}
          isSearchable={people.length > 8}
          onChange={(id) => {
            if (id !== null) setTo(id);
          }}
        />
      </SettingsStack>
    </Modal>
  );
}
