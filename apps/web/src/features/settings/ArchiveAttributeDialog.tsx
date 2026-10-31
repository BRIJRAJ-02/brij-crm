// Brief
// Purpose: make archiving an attribute a deliberate step, standard objects' included, saying its values are kept.
// Main task: read what happens (both ends go for a relationship, and one line naming what uses it), then Archive
// <title> or Cancel.
// Leaves out: deleting values; a restore from the Archived section brings it back at its old place.
import { isDataError, type AttributeDefinition } from '@crm/data';
import { Button, Callout, Modal, sharedStrings } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { strings } from './attribute-strings.ts';
import { usedByLine } from './impact-lines.ts';

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
  // What uses it, read as the confirm opens (flow pass, 30 October 2026); nothing is said until it answers, and a
  // failed read says nothing (the confirm still works).
  const [usedBy, setUsedBy] = useState<string | undefined>(undefined);
  useEffect(() => {
    let isCurrent = true;
    data.attributes.impact(slug, attribute.id).then(
      (impact) => {
        if (isCurrent) setUsedBy(usedByLine(impact));
      },
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
  }, [data, slug, attribute.id]);
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
        setFailure(isDataError(error) ? error.message : sharedStrings.couldntDoThat);
      },
    );
  };
  return (
    <Modal
      title={strings.confirmTitle(attribute.title)}
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
            {isBusy ? strings.archiving : strings.confirmArchive(attribute.title)}
          </Button>
        </>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      {attribute.type === 'record_reference' ? strings.confirmBoth : strings.confirmText}
      {usedBy !== undefined && <Callout>{usedBy}</Callout>}
    </Modal>
  );
}
