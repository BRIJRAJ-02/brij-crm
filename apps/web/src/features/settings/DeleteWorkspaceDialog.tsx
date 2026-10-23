// Brief
// Purpose: the owner's last check before deleting the workspace (spec 0031, AC-823): what happens, in one sentence.
// Main task: type the workspace's name, then Delete workspace; the server checks the name again.
// Leaves out: restoring (the workspace's own address does that for 30 days) and exporting (a quiet line suggests it first).
import { isDataError, namesMatch, type DataLayer, type DeletedWorkspace } from '@crm/data';
import { Button, Field, Modal } from '@crm/ui';
import { useState } from 'react';
import { strings } from './workspace-strings.ts';

/** Props for the delete dialog. */
export interface DeleteWorkspaceDialogProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The workspace's name, which the owner types to confirm. */
  readonly name: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** The server deleted it: the page moves the owner on. */
  readonly onDeleted: (deleted: DeletedWorkspace) => void;
}

/**
 * A danger Modal a click outside won't close: one sentence saying what happens and the 30 days to restore, the name
 * field with a quiet line to export first, then Cancel (ESC) and Delete workspace, which stays disabled until the
 * typed name matches.
 */
export function DeleteWorkspaceDialog({ data, slug, name, isOpen, onClose, onDeleted }: DeleteWorkspaceDialogProps) {
  const [typed, setTyped] = useState('');
  const [isBusy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  // Straight quotes and extra spaces count, as the server counts them.
  const matches = namesMatch(typed, name);
  const commit = () => {
    if (!matches || isBusy) return;
    setBusy(true);
    setFailure(undefined);
    data.workspace.delete(slug, typed).then(
      (deleted) => {
        setBusy(false);
        onDeleted(deleted);
      },
      (error: unknown) => {
        setBusy(false);
        setFailure(isDataError(error) ? error.message : strings.somethingWrong);
      },
    );
  };
  return (
    <Modal
      title={strings.deleteTitle(name)}
      tone="danger"
      isDismissable={false}
      isOpen={isOpen}
      isBusy={isBusy}
      onOpenChange={(open) => {
        if (!open && !isBusy) {
          setTyped('');
          setFailure(undefined);
          onClose();
        }
      }}
      actions={
        <>
          <Button slot="close" kbd="ESC" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="danger-solid" isDisabled={!matches} isPending={isBusy} onPress={commit}>
            {strings.deleteAction}
          </Button>
        </>
      }
    >
      <span>{strings.deleteText}</span>
      <Field
        label={strings.typeName(name)}
        value={typed}
        onChange={setTyped}
        onSubmit={commit}
        autoComplete="off"
        hint={strings.exportFirst}
        {...(failure === undefined ? {} : { error: failure })}
      />
    </Modal>
  );
}
