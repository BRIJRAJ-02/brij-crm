// The record header's More menu: Rename, Copy link, and Delete. Delete is one click
// with Undo, as a single row's delete in the table (owner rule, 21 October
// 2026: an Undo delete never asks first). It goes through the table's bulk
// path (one `records.deleteMany`), then back to the object's table with the
// Undo toast; a refusal stays on the page, said in a danger toast.
import type { ObjectSummary } from '@crm/data';
import { Button, Menu, MenuItem, MenuSeparator, MenuTrigger, sharedStrings, Tooltip } from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { bulkStrings, deleteToast } from '../workspace/bulk.ts';
import { objectHref } from '../workspace/objects.ts';
import { runUndo } from '../workspace/useUndoShortcut.ts';
import { strings } from './strings.ts';

/** Props for the record's More menu. */
export interface RecordActionsProps {
  readonly slug: string;
  readonly object: ObjectSummary;
  readonly recordId: string;
  /** The page's address, for Copy link. */
  readonly pageLink: string;
  /** Whether the person may delete it (the object's write access, as the table's bulk Delete). */
  readonly canDelete: boolean;
  /** Opens Rename, for someone who may change it: the name is the header, no longer a row in Details. */
  readonly onRename?: () => void;
}

/** "⋯" at the header's end: Rename and Copy link, then Delete (with Undo) for someone who may. */
export function RecordActions({ slug, object, recordId, pageLink, canDelete, onRename }: RecordActionsProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();

  const copyLink = () => {
    navigator.clipboard.writeText(pageLink).then(
      () => {
        toasts.toast({ tone: 'success', message: strings.linkCopied });
      },
      () => {
        toasts.toast({ tone: 'danger', message: sharedStrings.couldntCopy });
      },
    );
  };

  const remove = () => {
    data.records.deleteMany(slug, object.id, [recordId]).then(
      (result) => {
        const toast = deleteToast(result, object, (undoId) => {
          runUndo(data, toasts, slug, undoId);
        });
        if (result.kind === 'done' && result.deleted > 0) {
          // Back to the table it came from; the toast's Undo (or Cmd+Z) brings it back.
          void navigate({ href: objectHref(slug, object) });
          if (toast !== undefined) toasts.toast(toast);
          return;
        }
        // Refused (a read only object, a record gone meanwhile, the network): the page stays, and says why.
        toasts.toast({ tone: 'danger', message: toast?.message ?? bulkStrings.somethingWrong });
      },
      () => {
        toasts.toast({ tone: 'danger', message: bulkStrings.somethingWrong });
      },
    );
  };

  return (
    <MenuTrigger>
      <Tooltip content={strings.more}>
        <Button variant="ghost" icon="ellipsis" label={strings.more} />
      </Tooltip>
      <Menu
        label={strings.more}
        onAction={(key) => {
          if (key === 'rename') onRename?.();
          if (key === 'copy') copyLink();
          if (key === 'delete') remove();
        }}
      >
        {onRename === undefined ? null : (
          <MenuItem id="rename" icon="pencil">
            {strings.rename}
          </MenuItem>
        )}
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
  );
}
