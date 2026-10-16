// Brief
// Purpose: never save over someone else's filters silently (spec 0020, AC-469).
// Main task: choose Replace (mine over theirs) or Cancel (keep my draft, unsaved).
// Leaves out: Save as new view, which arrives with milestone 2's create dialog.
import { Button, Modal } from '@crm/ui';
import { strings } from './strings.ts';

/** Props for the clash dialog. */
export interface ViewChangedDialogProps {
  /** The server's sentence naming who saved ("Bea changed this view's filters since you started."); undefined while closed. */
  readonly sentence: string | undefined;
  readonly isReplacing: boolean;
  readonly onReplace: () => void;
  readonly onCancel: () => void;
}

/** "This view changed": Cancel first (focus starts there, Esc), then Replace. */
export function ViewChangedDialog({ sentence, isReplacing, onReplace, onCancel }: ViewChangedDialogProps) {
  return (
    <Modal
      title={strings.changedTitle}
      isOpen={sentence !== undefined}
      onOpenChange={(open) => {
        if (!open && !isReplacing) onCancel();
      }}
      actions={
        <>
          {/* The dialog opens on its safe choice (spec 0020): Replace overwrites someone else's filters. */}
          {/* eslint-disable-next-line jsx-a11y-x/no-autofocus */}
          <Button slot="close" isDisabled={isReplacing} kbd="ESC" autoFocus>
            {strings.keepMine}
          </Button>
          <Button variant="primary" isPending={isReplacing} onPress={onReplace}>
            {strings.replace}
          </Button>
        </>
      }
    >
      {strings.changedText(sentence ?? '')}
    </Modal>
  );
}
