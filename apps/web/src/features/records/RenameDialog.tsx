// Brief
// Purpose: rename a record from its page, now that its name is the header and not a row in Details (owner, 31 Oct).
// Main task: change the name through its one field editor and save it, optimistic through the data layer.
// Leaves out: every other attribute (Details edits them in place).
import { toFieldAttribute, type AttributeDefinition } from '@crm/data';
import { AttributeEditor, Button, Modal } from '@crm/ui';
import { useState } from 'react';
import { strings } from './strings.ts';

/** Props for the record's Rename dialog. */
export interface RenameDialogProps {
  /** The object's name attribute. */
  readonly attribute: AttributeDefinition;
  /** Its value now. */
  readonly value: unknown;
  readonly singularName: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** Saves the new name (the data layer applies it at once and rolls it back if refused). */
  readonly onSave: (value: unknown) => void;
}

/** A small dialog holding the name's one editor; Rename saves it, Cancel or Esc leaves it as it was. */
export function RenameDialog({ attribute, value, singularName, isOpen, onClose, onSave }: RenameDialogProps) {
  const [draft, setDraft] = useState<unknown>(value);
  const save = () => {
    onSave(draft);
    onClose();
  };
  return (
    <Modal
      title={strings.renameTitle(singularName)}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      actions={
        <>
          <Button slot="close">{strings.cancel}</Button>
          <Button variant="primary" onPress={save}>
            {strings.rename}
          </Button>
        </>
      }
    >
      <AttributeEditor
        attribute={toFieldAttribute(attribute)}
        value={draft ?? null}
        surface="form"
        onCommit={(next) => {
          setDraft(next);
        }}
      />
    </Modal>
  );
}
