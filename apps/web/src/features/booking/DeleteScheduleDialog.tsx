// Brief
// Purpose: confirm deleting a schedule (spec 0035, AC-967; the owner's confirm rule, 21 October 2026), naming the booking pages it moves to the default.
// Main task: read what happens to those pages, then Delete schedule (or Cancel); the dialog waits for the server and says a refusal inside itself.
// Leaves out: the default, which can't be deleted (its menu item says so), and anything that can be undone.
import { isDataError, type ScheduleView } from '@crm/data';
import { Button, Callout, Modal } from '@crm/ui';
import { useState } from 'react';
import { deleteSentence } from './schedules.ts';
import { scheduleStrings } from './schedule-strings.ts';
import { strings } from './strings.ts';

/** Props for the delete confirm. */
export interface DeleteScheduleDialogProps {
  /** The schedule to delete; undefined while the dialog is closed. */
  readonly schedule: ScheduleView | undefined;
  /** The default's name: the schedule its pages book by once it's gone. */
  readonly fallbackName: string;
  readonly onClose: () => void;
  /** Deletes it: the dialog shows busy until this settles, and says a refusal inside itself. */
  readonly onDelete: (schedule: ScheduleView) => Promise<unknown>;
  /** The server deleted it. */
  readonly onDeleted: (schedule: ScheduleView) => void;
}

/** "Delete the Evenings schedule?": a danger Modal, Cancel (ESC), then Delete schedule. */
export function DeleteScheduleDialog({ schedule, ...rest }: DeleteScheduleDialogProps) {
  // The last schedule stays while the Modal plays its exit; each schedule mounts afresh.
  const [last, setLast] = useState(schedule);
  if (schedule !== undefined && schedule !== last) setLast(schedule);
  const shown = schedule ?? last;
  return shown === undefined ? null : (
    <DeleteConfirm key={shown.id ?? 'default'} schedule={shown} isOpen={schedule !== undefined} {...rest} />
  );
}

/** The open confirm for one schedule. */
function DeleteConfirm({
  schedule,
  fallbackName,
  isOpen,
  onClose,
  onDelete,
  onDeleted,
}: Omit<DeleteScheduleDialogProps, 'schedule'> & { readonly schedule: ScheduleView; readonly isOpen: boolean }) {
  const [isBusy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const commit = () => {
    if (isBusy) return;
    setBusy(true);
    setFailure(undefined);
    onDelete(schedule).then(
      () => {
        setBusy(false);
        onDeleted(schedule);
      },
      (error: unknown) => {
        setBusy(false);
        setFailure(isDataError(error) ? error.message : strings.somethingWrong);
      },
    );
  };
  return (
    <Modal
      title={scheduleStrings.deleteTitle(schedule.name)}
      tone="danger"
      isOpen={isOpen}
      isBusy={isBusy}
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy} kbd="ESC">
            {strings.cancel}
          </Button>
          <Button variant="danger-solid" icon="trash" isPending={isBusy} onPress={commit}>
            {isBusy ? scheduleStrings.deleting : scheduleStrings.deleteCommit}
          </Button>
        </>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      {deleteSentence(
        schedule.pages.map((page) => page.title),
        fallbackName,
      )}
    </Modal>
  );
}
