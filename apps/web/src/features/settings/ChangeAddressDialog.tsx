// Brief
// Purpose: the last check before the workspace moves to a new web address (Settings › Workspace › General).
// Main task: read what happens to old links, then Change address; Cancel keeps the old one and the typed draft.
// Leaves out: editing the address here (the field on the page does that) and any typed confirm: nothing is lost.
import { Button, Modal } from '@crm/ui';
import { strings } from './workspace-strings.ts';

/** Props for the address change confirm. */
export interface ChangeAddressDialogProps {
  /** The address now, and the one it moves to. */
  readonly from: string;
  readonly to: string;
  readonly isOpen: boolean;
  /** The save is on its way: the dialog waits, and won't close. */
  readonly isBusy: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}

/**
 * A Modal saying where the workspace moves and that links with the old
 * address keep working, then Cancel (ESC) and Change address. It stays open
 * while the save runs; the page closes it once the answer comes.
 */
export function ChangeAddressDialog({ from, to, isOpen, isBusy, onClose, onConfirm }: ChangeAddressDialogProps) {
  return (
    <Modal
      title={strings.moveTitle}
      isOpen={isOpen}
      isBusy={isBusy}
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" kbd="ESC" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="primary" isPending={isBusy} onPress={onConfirm}>
            {strings.moveAction}
          </Button>
        </>
      }
    >
      {strings.moveText(from, to)}
    </Modal>
  );
}
