// Brief
// Purpose: never save over someone else's filters silently (spec 0020, AC-469).
// Main task: choose Replace (mine over theirs), Save as new view (keep both), or Cancel (keep my draft, unsaved).
// Leaves out: merging the two filters.
import { Button, Modal } from '@crm/ui';
import { strings } from './strings.ts';

/** Props for the clash dialog. */
export interface ViewChangedDialogProps {
  /** The server's sentence naming who saved ("Bea changed this view's filters since you started."); undefined while closed. */
  readonly sentence: string | undefined;
  readonly isReplacing: boolean;
  readonly onReplace: () => void;
  /** Opens the create dialog with the draft, as a new view; absent when the person may not make one. */
  readonly onSaveAsNew?: () => void;
  readonly onCancel: () => void;
}

/** "This view changed": Cancel first (focus starts there, Esc), then Save as new view, then Replace. */
export function ViewChangedDialog({ sentence, isReplacing, onReplace, onSaveAsNew, onCancel }: ViewChangedDialogProps) {
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
          {onSaveAsNew !== undefined && (
            <Button isDisabled={isReplacing} onPress={onSaveAsNew}>
              {strings.saveAsNew}
            </Button>
          )}
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
