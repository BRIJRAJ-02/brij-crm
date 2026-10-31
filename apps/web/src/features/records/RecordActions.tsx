// The record header's More menu: Copy link, and Delete. Delete is one click
// with Undo, as a single row's delete in the table (owner rule, 21 October
// 2026: an Undo delete never asks first). It goes through the table's bulk
// path (one `records.deleteMany`), then back to the object's table with the
// Undo toast; a refusal stays on the page, said in a danger toast. Merge with… (spec 0049) asks for the other record
// and opens the merge dialog, which is its own confirmation; a merge that took this record away goes on to the kept.
import type { AttributeDefinition, MemberSummary, ObjectSummary } from '@crm/data';
import { Button, focusLater, Menu, MenuItem, MenuSeparator, MenuTrigger, sharedStrings, Tooltip } from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useRef } from 'react';
import { mergeStrings, useMergeDialog } from '../duplicates/merge/index.ts';
import { bulkStrings, deleteToast } from '../workspace/bulk.ts';
import { objectHref } from '../workspace/objects.ts';
import { runUndo } from '../workspace/useUndoShortcut.ts';
import { recordHref } from './details.ts';
import { strings } from './strings.ts';

/** Props for the record's More menu. */
export interface RecordActionsProps {
  readonly slug: string;
  readonly object: ObjectSummary;
  readonly recordId: string;
  /** The page's address, for Copy link. */
  readonly pageLink: string;
  /** Whether the person may delete it (the object's write access, as the table's bulk Delete); merging needs the same. */
  readonly canDelete: boolean;
  /** The object's attributes and the members, for the merge dialog's values. */
  readonly attributes: readonly AttributeDefinition[];
  readonly members: readonly MemberSummary[];
}

/** "⋮" beside Copy link: Copy link, then Delete (with Undo) for someone who may. */
export function RecordActions({
  slug,
  object,
  recordId,
  pageLink,
  canDelete,
  attributes,
  members,
}: RecordActionsProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const moreRef = useRef<HTMLButtonElement>(null);
  const merging = useMergeDialog({
    slug,
    object,
    attributes,
    members,
    onCancel: () => {
      focusLater(() => moreRef.current);
    },
    onMerged: ({ keptId, mergedId }) => {
      // This record was the one merged away: on to the one it went into, focus on its title (the trigger is gone).
      if (mergedId === recordId) {
        void navigate({ href: recordHref(slug, object.apiSlug, keptId), replace: true }).then(() => {
          focusLater(() => document.querySelector('h1'));
        });
        return;
      }
      // This record was kept: focus back on More, which opened the dialog through a menu item now gone.
      focusLater(() => moreRef.current);
    },
  });

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
    <>
      <MenuTrigger>
        <Tooltip content={strings.more}>
          <Button ref={moreRef} variant="ghost" icon="ellipsis" label={strings.more} />
        </Tooltip>
        <Menu
          label={strings.more}
          onAction={(key) => {
            if (key === 'copy') copyLink();
            if (key === 'delete') remove();
            if (key === 'merge') merging.open([recordId]);
          }}
        >
          <MenuItem id="copy" icon="link">
            {strings.copyLink}
          </MenuItem>
          {canDelete ? (
            <MenuItem id="merge" icon="layers">
              {mergeStrings.mergeWith}
            </MenuItem>
          ) : null}
          {canDelete ? <MenuSeparator /> : null}
          {canDelete ? (
            <MenuItem id="delete" icon="trash" isDanger>
              {strings.deleteRecord(object.singularName)}
            </MenuItem>
          ) : null}
        </Menu>
      </MenuTrigger>
      {merging.dialog}
    </>
  );
}
