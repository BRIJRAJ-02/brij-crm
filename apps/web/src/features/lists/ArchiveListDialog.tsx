// Brief
// Purpose: confirm archiving a list (spec 0048, AC-4831), saying that its entries are kept and where to restore it.
// Main task: read the sentence, then Archive (or Cancel); the list leaves every sidebar once the server agrees.
// Leaves out: deleting anything; Restore is on the archived list's page and in Settings › Lists.
import { isDataError, type DataLayer, type ListView } from '@crm/data';
import { Button, Callout, Modal } from '@crm/ui';
import { useState } from 'react';
import { strings } from './strings.ts';

/** Props for the archive confirm. */
export interface ArchiveListDialogProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The list to archive; undefined while the dialog is closed. */
  readonly list: ListView | undefined;
  readonly onClose: () => void;
  /** The server archived it. */
  readonly onArchived: (list: ListView) => void;
}

/** "Archive Sales pipeline?": a danger Modal with Cancel (Esc) and Archive. */
export function ArchiveListDialog({ list, ...rest }: ArchiveListDialogProps) {
  // The last list stays while the Modal plays its exit.
  const [last, setLast] = useState(list);
  if (list !== undefined && list !== last) setLast(list);
  const shown = list ?? last;
  return shown === undefined ? null : (
    <ArchiveConfirm key={shown.id} list={shown} isOpen={list !== undefined} {...rest} />
  );
}

/** The open confirm for one list. */
function ArchiveConfirm({
  data,
  slug,
  list,
  onClose,
  onArchived,
  isOpen,
}: Omit<ArchiveListDialogProps, 'list'> & { readonly list: ListView; readonly isOpen: boolean }) {
  const [isBusy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const archive = () => {
    if (isBusy) return;
    setBusy(true);
    setFailure(undefined);
    data.lists.archive(slug, list.id).then(
      (archived) => {
        setBusy(false);
        onArchived(archived);
      },
      (error: unknown) => {
        setBusy(false);
        setFailure(isDataError(error) ? error.message : strings.archiveFailed);
      },
    );
  };
  return (
    <Modal
      title={strings.archiveTitle(list.name)}
      variant="confirm"
      tone="danger"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="danger-solid" icon="archive" isPending={isBusy} onPress={archive}>
            {strings.archiveAction}
          </Button>
        </>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      {strings.archiveText}
    </Modal>
  );
}
