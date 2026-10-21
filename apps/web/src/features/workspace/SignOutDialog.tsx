// Brief
// Purpose: ask before signing out (the owner, 21 October 2026): it ends this device's session.
// Main task: Sign out, or Cancel; the session ends once the server agrees, then sign in opens.
// Leaves out: signing out other devices, and anything about the workspace.
import { Button, Callout, Modal } from '@crm/ui';
import { strings } from './strings.ts';

/** Props for the sign out confirm. */
export interface SignOutDialogProps {
  readonly isOpen: boolean;
  /** Signing out is under way: the commit spins, and nothing closes the dialog. */
  readonly isBusy: boolean;
  /** Why the last try failed, shown inside the dialog, which stays open. */
  readonly failure: string | undefined;
  readonly onSignOut: () => void;
  readonly onClose: () => void;
}

/**
 * "Sign out?": a plain dialog (signing out destroys nothing), Cancel (ESC)
 * first, Sign out last. Cancel or Esc puts focus back on the menu's button.
 */
export function SignOutDialog({ isOpen, isBusy, failure, onSignOut, onClose }: SignOutDialogProps) {
  return (
    <Modal
      title={strings.signOutTitle}
      isOpen={isOpen}
      isBusy={isBusy}
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" kbd="ESC" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="primary" isPending={isBusy} onPress={onSignOut}>
            {isBusy ? strings.signingOut : strings.signOut}
          </Button>
        </>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      {strings.signOutText}
    </Modal>
  );
}
