// Brief
// Purpose: ask before leaving the workspace (spec 0031, AC-812; the owner, 21 October 2026): it ends the person's
// access at once.
// Main task: Leave workspace, or Cancel; once the server agrees, the next workspace opens (or making one).
// Leaves out: who else may remove them (the Members page), and the only owner's way out (they hand ownership on
// first, slice 4); the server refuses them LAST_OWNER, said inside the dialog.
import { isDataError, type DataLayer } from '@crm/data';
import { Button, Callout, Modal } from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { strings } from './strings.ts';

/** Props for the leave confirm. */
export interface LeaveDialogProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly workspaceName: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

/**
 * "Leave Acme?": a danger dialog (an alert a click outside won't close),
 * Cancel (ESC) first and Leave workspace last, busy while the server works,
 * and its refusal (`LAST_OWNER`'s sentence) inside it, which stays open.
 */
export function LeaveDialog({ data, slug, workspaceName, isOpen, onClose }: LeaveDialogProps) {
  const navigate = useNavigate();
  const [isBusy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const leave = () => {
    if (isBusy) return;
    setBusy(true);
    setFailure(undefined);
    data.members.leave(slug).then(
      () => {
        // `/` opens the workspace they last used that is still theirs, else their oldest, else making one (AC-802).
        void navigate({ to: '/', replace: true });
      },
      (error: unknown) => {
        setBusy(false);
        setFailure(isDataError(error) ? error.message : strings.somethingWrong);
      },
    );
  };
  return (
    <Modal
      title={strings.leaveTitle(workspaceName)}
      variant="confirm"
      tone="danger"
      isOpen={isOpen}
      isBusy={isBusy}
      onOpenChange={(open) => {
        if (!open && !isBusy) {
          setFailure(undefined);
          onClose();
        }
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="danger-solid" isPending={isBusy} onPress={leave}>
            {isBusy ? strings.leaving : strings.leaveWorkspace}
          </Button>
        </>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      {strings.leaveText}
    </Modal>
  );
}
