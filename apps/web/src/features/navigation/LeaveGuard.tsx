// Brief
// Purpose: ask before leaving an editor with unsaved changes (the booking page editor, Availability, Profile), in a Modal like
// every other ending action (the owner's rule), not the browser's own confirm.
// Main task: Keep editing (Esc), or Leave without saving.
// Leaves out: closing the tab or reloading, which only the browser's own prompt can ask about (`enableBeforeUnload`).
import { Button, Modal } from '@crm/ui';
import { useBlocker } from '@tanstack/react-router';
import { strings } from './strings.ts';

/** Props for the leave guard. */
export interface LeaveGuardProps {
  /** Whether anything on screen is unsaved; nothing is asked while it is false. */
  readonly isDirty: boolean;
  /**
   * True when only the address's search may change without leaving: the booking page editor's tabs are `?tab=`, so
   * moving between them keeps the editor and its changes. Availability's `?schedule=` opens another schedule, so it
   * leaves (false).
   */
  readonly searchStays?: boolean;
}

/**
 * Blocks a navigation away while there are unsaved changes and asks in a danger Modal: Keep editing stays (Esc, a
 * click outside does nothing), Leave without saving goes on. Closing or reloading the tab asks the browser's way.
 */
export function LeaveGuard({ isDirty, searchStays = false }: LeaveGuardProps) {
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => isDirty && !(searchStays && current.pathname === next.pathname),
    enableBeforeUnload: () => isDirty,
    withResolver: true,
  });
  return (
    <Modal
      title={strings.leaveTitle}
      variant="confirm"
      tone="danger"
      isOpen={blocker.status === 'blocked'}
      onOpenChange={(isOpen) => {
        if (!isOpen && blocker.status === 'blocked') blocker.reset();
      }}
      actions={
        <>
          <Button slot="close">{strings.leaveStay}</Button>
          <Button
            variant="danger-solid"
            onPress={() => {
              if (blocker.status === 'blocked') blocker.proceed();
            }}
          >
            {strings.leaveGo}
          </Button>
        </>
      }
    >
      {strings.leaveText}
    </Modal>
  );
}
