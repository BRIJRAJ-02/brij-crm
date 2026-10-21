// Brief
// Purpose: ask before signing out (the owner, 21 October 2026): it ends this device's session.
// Main task: Sign out, or Cancel; the session ends once the server agrees, then sign in opens.
// Leaves out: signing out other devices, and anything about a workspace. The same dialog the workspace menu asks
// with (spec 0031), for the pages before the app (first run).
import { Button, Callout, Modal } from '@crm/ui';
import { strings } from './strings.ts';

/** Props for the sign out confirm. */
export interface SignOutDialogProps {
  readonly isOpen: boolean;
  /** Signing out is under way: the commit spins, and nothing closes the dialog. */
  readonly isBusy: boolean;
  /** Why the last try failed, shown inside the dialog, which stays open. */
  readonly failure: string | undefined;
  /** What signing out means here, when it says more than the default (the invitation page: you come back to it). */
  readonly text?: string;
  readonly onSignOut: () => void;
  readonly onClose: () => void;
}

/**
 * "Sign out?": a plain dialog (signing out destroys nothing), Cancel (ESC)
 * first, Sign out last. Cancel or Esc puts focus back on what opened it.
 */
export function SignOutDialog({
  isOpen,
  isBusy,
  failure,
  text = strings.signOutText,
  onSignOut,
  onClose,
}: SignOutDialogProps) {
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
      {text}
    </Modal>
  );
}
