// Brief
// Purpose: confirm archiving an object, standard ones included, saying how many records it holds and that they stay.
// Main task: read the count, then Archive <plural> (or Cancel); the object leaves every sidebar once the server agrees.
// Leaves out: deleting anything; archiving is reversible from the Archived section or the object's page.
import { isDataError, type DataLayer, type ObjectSummary } from '@crm/data';
import { Button, Callout, Modal } from '@crm/ui';
import { useEffect, useState } from 'react';
import { strings } from './strings.ts';

/** Props for the archive confirm. */
export interface ArchiveObjectDialogProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The object to archive; undefined while the dialog is closed. */
  readonly object: ObjectSummary | undefined;
  readonly onClose: () => void;
  /** The server archived it. */
  readonly onArchived: (object: ObjectSummary) => void;
}

/** "Archive Projects?": a danger Modal with the record count, Cancel (ESC) and Archive Projects. */
export function ArchiveObjectDialog({ object, ...rest }: ArchiveObjectDialogProps) {
  // The last object stays while the Modal plays its exit; each object mounts afresh, reading its own count.
  const [last, setLast] = useState(object);
  if (object !== undefined && object !== last) setLast(object);
  const shown = object ?? last;
  return shown === undefined ? null : (
    <ArchiveConfirm key={shown.id} object={shown} isOpen={object !== undefined} {...rest} />
  );
}

/** The open confirm for one object. */
function ArchiveConfirm({
  data,
  slug,
  object,
  onClose,
  onArchived,
  isOpen,
}: Omit<ArchiveObjectDialogProps, 'object'> & { readonly object: ObjectSummary; readonly isOpen: boolean }) {
  const [isBusy, setBusy] = useState(false);
  const [count, setCount] = useState<{ readonly count: number; readonly atLeast: boolean } | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  // The count is read once; until it comes the sentence says the records are kept without a number.
  useEffect(() => {
    let isCurrent = true;
    data.records.count(slug, object.id).then(
      (total) => {
        if (isCurrent) setCount(total);
      },
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
  }, [data, slug, object.id]);
  const records = count === undefined ? undefined : new Intl.NumberFormat().format(count.count);
  const archive = () => {
    if (isBusy) return;
    setBusy(true);
    setFailure(undefined);
    data.objects.archive(slug, object.id).then(
      (archived) => {
        setBusy(false);
        onArchived(archived);
      },
      (error: unknown) => {
        setBusy(false);
        setFailure(isDataError(error) ? error.message : strings.somethingWrong);
      },
    );
  };
  return (
    <Modal
      title={strings.confirmTitle(object.pluralName)}
      tone="danger"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy} kbd="ESC">
            {strings.cancel}
          </Button>
          <Button variant="danger" icon="archive" isPending={isBusy} onPress={archive}>
            {isBusy ? strings.archiving : strings.dangerArchive(object.pluralName)}
          </Button>
        </>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      {records === undefined || count === undefined
        ? strings.confirmCounting
        : strings.confirmText(records, count.count, count.atLeast)}
    </Modal>
  );
}
