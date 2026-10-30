// The Add modal's kinds, and the one confirm before a block leaves the page for good (spec 0058, AC-9 and AC-18):
// small pieces of the link page editor, kept apart so each is drawn and checked on its own.
import type { ProfileItem } from '@crm/data';
import { Button, Modal, TileGrid } from '@crm/ui';
import { ADDABLE, BLOCK_KINDS, rowWords, type AddableKind } from './registry.tsx';
import { strings } from './strings.ts';

/** Props for KindPicker. */
export interface KindPickerProps {
  /** The kind the Add modal shows the fields of. */
  readonly value: AddableKind;
  /** Why a kind can't take one more (the limit's sentence), or undefined while it has room. */
  readonly fullReason: (kind: AddableKind) => string | undefined;
  readonly onChange: (kind: AddableKind) => void;
}

/**
 * Every kind as a tile: its icon over a short name, picked by sight (spec 0058, AC-9). The line about each kind is
 * its tooltip and its description for screen readers, never a paragraph under it; a kind that is full is off, with
 * the limit's sentence in its tooltip instead. One tab stop, the arrows move and pick, as any radio group.
 */
export function KindPicker({ value, fullReason, onChange }: KindPickerProps) {
  return (
    <TileGrid
      variant="choice"
      label={strings.addWhat}
      value={value}
      tiles={ADDABLE.map((kind) => {
        const entry = BLOCK_KINDS[kind];
        const full = fullReason(kind);
        return {
          id: kind,
          name: entry.label,
          icon: entry.icon,
          description: full ?? entry.description,
          ...(full === undefined ? {} : { isDisabled: true }),
        };
      })}
      onChange={(chosen) => {
        const kind = ADDABLE.find((each) => each === chosen);
        if (kind !== undefined) onChange(kind);
      }}
    />
  );
}

/** Props for DeleteBlockDialog. */
export interface DeleteBlockDialogProps {
  /** The block being deleted, or a booking page block being taken off the page. */
  readonly item: ProfileItem;
  /** The delete is on its way: the confirm waits, busy, and can't be closed under it. */
  readonly isBusy: boolean;
  readonly onCancel: () => void;
  readonly onDelete: () => void;
}

/**
 * Delete asks first, in a Modal (the owner's rule, 21 October 2026, kept by spec 0058, AC-18): the question names
 * the block, one line says what happens, and two buttons, Cancel first. A booking page block is taken off the page,
 * not deleted, and its words say so.
 */
export function DeleteBlockDialog({ item, isBusy, onCancel, onDelete }: DeleteBlockDialogProps) {
  const title = rowWords(item).title;
  const isPage = item.kind === 'page';
  return (
    <Modal
      title={isPage ? strings.removePageTitle(title) : strings.deleteTitle(title)}
      variant="confirm"
      tone="danger"
      isOpen
      isBusy={isBusy}
      onOpenChange={(open) => {
        if (!open && !isBusy) onCancel();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="danger-solid" icon="trash" isPending={isBusy} onPress={onDelete}>
            {isPage ? strings.removePage : strings.deleteBlock}
          </Button>
        </>
      }
    >
      {isPage ? strings.removePageText : strings.deleteText}
    </Modal>
  );
}
