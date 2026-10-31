// Brief
// Purpose: rename a record from its page or panel, now that its name is the header and not a row in Details (owner, 31 Oct).
// Main task: change the name through its one field editor and save it with Enter or Rename, optimistic through the data layer.
// Leaves out: every other attribute (Details edits them in place).
import { toFieldAttribute, type AttributeDefinition } from '@crm/data';
import { AttributeEditor, Button, Form, Modal } from '@crm/ui';
import { useId, useRef, useState } from 'react';
import { isFilled } from './details.ts';
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
  /** Saves the new name (the data layer applies it at once and rolls it back, with a toast, if refused). */
  readonly onSave: (value: unknown) => void;
}

/** Whether two values are the same name. */
const isSame = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * A small form holding the name's one editor, focused as it opens. Enter or Rename saves it (nothing is sent when
 * it didn't change); Rename stays off while the name is blank, so a record never falls back to "Unnamed" by accident.
 */
export function RenameDialog({ attribute, value, singularName, isOpen, onClose, onSave }: RenameDialogProps) {
  const formId = useId();
  const [draft, setDraft] = useState<unknown>(value);
  // The editor commits on Enter in the same event that submits the form: the ref holds that commit for the submit.
  const latest = useRef<unknown>(value);
  const save = () => {
    const next = latest.current;
    if (!isFilled(next)) return;
    if (!isSame(next, value)) onSave(next);
    onClose();
  };
  return (
    <Modal
      title={strings.renameTitle(singularName)}
      isOpen={isOpen}
      // Once something is typed, only Cancel or Esc throws it away.
      isDismissable={isSame(draft, value)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      actions={
        <>
          <Button slot="close">{strings.cancel}</Button>
          <Button variant="primary" type="submit" form={formId} isDisabled={!isFilled(draft)}>
            {strings.rename}
          </Button>
        </>
      }
    >
      <Form id={formId} focusesFirstField="select" onSubmit={save}>
        <AttributeEditor
          attribute={toFieldAttribute(attribute)}
          value={draft ?? null}
          surface="form"
          onCommit={(next) => {
            latest.current = next;
            setDraft(next);
          }}
        />
      </Form>
    </Modal>
  );
}
