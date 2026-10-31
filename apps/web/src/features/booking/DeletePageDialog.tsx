// Brief
// Purpose: the confirm before a booking page is deleted, from its card on Links or its editor's menu.
// Main task: Delete page, busy until the server answers, saying a refusal in place; Cancel or Escape keeps it.
// Leaves out: what happens after (the caller's toast and where it goes).
import type { BookingPageView } from '@crm/data';
import { isDataError } from '@crm/data';
import { Button, Callout, Modal } from '@crm/ui';
import { useState } from 'react';
import { strings } from './strings.ts';

/** Props for the delete confirm. */
export interface DeletePageDialogProps {
  /** The page to delete; undefined while the dialog is closed. */
  readonly page: BookingPageView | undefined;
  readonly onClose: () => void;
  /** Deletes it: settles once the server has it, rejects with why on a refusal (the card is back by then). */
  readonly onDelete: (page: BookingPageView) => Promise<void>;
}

/**
 * Delete <title>?: its link stops working (AC-648); its bookings stay. The card leaves at once, and the commit
 * stays busy until the server answers; a refusal shows here, with the card back in the list.
 */
export function DeletePageDialog({ page, ...rest }: DeletePageDialogProps) {
  // The last page stays while the Modal plays its exit; each page mounts afresh.
  const [last, setLast] = useState(page);
  if (page !== undefined && page !== last) setLast(page);
  const shown = page ?? last;
  return shown === undefined ? null : (
    <DeletePageConfirm key={shown.id} page={shown} isOpen={page !== undefined} {...rest} />
  );
}

/** The open confirm for one page. */
function DeletePageConfirm({
  page,
  isOpen,
  onClose,
  onDelete,
}: Omit<DeletePageDialogProps, 'page'> & { readonly page: BookingPageView; readonly isOpen: boolean }) {
  const [isBusy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const remove = () => {
    if (isBusy) return;
    setBusy(true);
    setFailure(undefined);
    onDelete(page).then(
      () => {
        setBusy(false);
      },
      (error: unknown) => {
        setBusy(false);
        setFailure(isDataError(error) && error.message !== '' ? error.message : strings.somethingWrong);
      },
    );
  };
  return (
    <Modal
      title={
        page.ownerName === undefined
          ? strings.deleteTitle(page.title)
          : strings.deleteTitleFor(page.ownerName, page.title)
      }
      variant="confirm"
      tone="danger"
      isOpen={isOpen}
      isBusy={isBusy}
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="danger-solid" icon="trash" isPending={isBusy} onPress={remove}>
            {isBusy ? strings.deleting : strings.deleteAction}
          </Button>
        </>
      }
    >
      {failure !== undefined && (
        <Callout tone="danger" isAnnounced>
          {failure}
        </Callout>
      )}
      {strings.deleteText}
    </Modal>
  );
}
