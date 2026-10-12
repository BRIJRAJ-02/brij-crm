// Brief
// Purpose: make archiving an attribute a deliberate step, standard objects' included, saying its values are kept.
// Main task: read what happens (both ends go for a relationship), then Archive <title> or Cancel.
// Leaves out: deleting values; a restore from the Archived section brings it back at its old place.
import { isDataError, type AttributeDefinition } from '@crm/data';
import { Button, Callout, Modal } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { strings } from './attribute-strings.ts';

/** Props for the attribute archive confirm. */
export interface ArchiveAttributeDialogProps {
  readonly slug: string;
  /** The attribute to archive; undefined while the dialog is closed. */
  readonly attribute: AttributeDefinition | undefined;
  readonly onClose: () => void;
  /** The server archived it: every definition it changed (both ends of a relationship). */
  readonly onArchived: (ends: readonly AttributeDefinition[]) => void;
}

/** "Archive Job title?": a danger Modal, Cancel (ESC) and Archive Job title. */
export function ArchiveAttributeDialog({ attribute, ...rest }: ArchiveAttributeDialogProps) {
  // The last attribute stays while the Modal plays its exit; each one mounts afresh.
  const [last, setLast] = useState(attribute);
  if (attribute !== undefined && attribute !== last) setLast(attribute);
  const shown = attribute ?? last;
  return shown === undefined ? null : (
    <ArchiveConfirm key={shown.id} attribute={shown} isOpen={attribute !== undefined} {...rest} />
  );
}

/** The open confirm for one attribute. */
function ArchiveConfirm({
  slug,
  attribute,
  onClose,
  onArchived,
  isOpen,
}: Omit<ArchiveAttributeDialogProps, 'attribute'> & {
  readonly attribute: AttributeDefinition;
  readonly isOpen: boolean;
}) {
  const { data } = useRouteContext({ from: '__root__' });
  const [isBusy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const archive = () => {
    if (isBusy) return;
    setBusy(true);
    setFailure(undefined);
    data.attributes.archive(slug, attribute.id).then(
      (ends) => {
        setBusy(false);
        onArchived(ends);
      },
      (error: unknown) => {
        setBusy(false);
        setFailure(isDataError(error) ? error.message : strings.somethingWrong);
      },
    );
  };
  return (
    <Modal
      title={strings.confirmTitle(attribute.title)}
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
            {isBusy ? strings.archiving : strings.confirmArchive(attribute.title)}
          </Button>
        </>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      {attribute.type === 'record_reference' ? strings.confirmBoth : strings.confirmText}
    </Modal>
  );
}
