// The record header's More menu (Copy link, Delete) and Delete's confirm.
// Delete goes through the same path as the table's bulk delete (one
// `records.deleteMany`), then the page goes back to the object's table with
// an Undo toast; a refusal stays in the confirm, saying why.
import type { ObjectSummary } from '@crm/data';
import { Button, Callout, Menu, MenuItem, MenuSeparator, MenuTrigger, Modal, Tooltip } from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { bulkStrings, deleteToast } from '../workspace/bulk.ts';
import { objectHref } from '../workspace/objects.ts';
import { runUndo } from '../workspace/useUndoShortcut.ts';
import { strings } from './strings.ts';

/** Props for the record's More menu. */
export interface RecordActionsProps {
  readonly slug: string;
  readonly object: ObjectSummary;
  readonly recordId: string;
  /** The record's name, as the header shows it: Delete's question names it. */
  readonly name: string;
  /** The page's address, for Copy link. */
  readonly pageLink: string;
  /** Whether the person may delete it (the object's write access, as the table's bulk Delete). */
  readonly canDelete: boolean;
}

/** "⋮" beside Favourite and Copy link: Copy link, then Delete (asks first) for someone who may. */
export function RecordActions({ slug, object, recordId, name, pageLink, canDelete }: RecordActionsProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const [isAsking, setAsking] = useState(false);
  const [isDeleting, setDeleting] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);

  const copyLink = () => {
    navigator.clipboard.writeText(pageLink).then(
      () => {
        toasts.toast({ tone: 'success', message: strings.linkCopied });
      },
      () => {
        toasts.toast({ tone: 'danger', message: strings.copyFailed });
      },
    );
  };

  const remove = () => {
    setDeleting(true);
    setRefusal(undefined);
    data.records.deleteMany(slug, object.id, [recordId]).then(
      (result) => {
        setDeleting(false);
        const toast = deleteToast(result, object, (undoId) => {
          runUndo(data, toasts, slug, undoId);
        });
        if (result.kind === 'done' && result.deleted > 0) {
          setAsking(false);
          // Back to the table it came from; the toast's Undo (or Cmd+Z) brings it back.
          void navigate({ href: objectHref(slug, object) });
          if (toast !== undefined) toasts.toast(toast);
          return;
        }
        // Refused (a read only object, a record gone meanwhile, the network): said inside, to try again or cancel.
        setRefusal(toast?.message ?? bulkStrings.somethingWrong);
      },
      () => {
        setDeleting(false);
        setRefusal(bulkStrings.somethingWrong);
      },
    );
  };

  return (
    <>
      <MenuTrigger>
        <Tooltip content={strings.more}>
          <Button variant="ghost" icon="ellipsis" label={strings.more} />
        </Tooltip>
        <Menu
          label={strings.more}
          onAction={(key) => {
            if (key === 'copy') copyLink();
            if (key === 'delete') {
              setRefusal(undefined);
              setAsking(true);
            }
          }}
        >
          <MenuItem id="copy" icon="link">
            {strings.copyLink}
          </MenuItem>
          {canDelete ? <MenuSeparator /> : null}
          {canDelete ? (
            <MenuItem id="delete" icon="trash" isDanger>
              {strings.deleteRecord(object.singularName)}
            </MenuItem>
          ) : null}
        </Menu>
      </MenuTrigger>
      <Modal
        title={strings.deleteTitle(name)}
        tone="danger"
        isOpen={isAsking}
        isBusy={isDeleting}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setAsking(false);
        }}
        actions={
          <>
            <Button slot="close" kbd="ESC" isDisabled={isDeleting}>
              {strings.cancel}
            </Button>
            <Button variant="danger-solid" icon="trash" isPending={isDeleting} onPress={remove}>
              {isDeleting ? strings.deleting : strings.deleteRecord(object.singularName)}
            </Button>
          </>
        }
      >
        {refusal !== undefined && (
          <Callout tone="danger" isAnnounced>
            {refusal}
          </Callout>
        )}
        {strings.deleteText}
      </Modal>
    </>
  );
}
