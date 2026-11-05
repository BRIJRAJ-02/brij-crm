// A form in a drawer at the end edge (checklabs edits every part in a right hand sheet), that never loses what was
// typed by surprise: closing it with changes asks first, and so does leaving the page (LeaveGuard).
import { Button, Modal } from '@crm/ui';
import { useState, type ReactNode } from 'react';
import { LeaveGuard } from '../navigation/LeaveGuard.tsx';
import { strings } from './strings.ts';

/** The drawer, its footer and the ask before throwing changes away. */
export function DrawerForm({
  isOpen = true,
  title,
  isDirty,
  isBusy = false,
  onClose,
  actions,
  footerStart,
  children,
}: {
  /** Open; a screen that keeps the drawer mounted while it closes passes false, so it slides out. */
  readonly isOpen?: boolean;
  readonly title: string;
  readonly isDirty: boolean;
  readonly isBusy?: boolean;
  readonly onClose: () => void;
  readonly actions: ReactNode;
  readonly footerStart?: ReactNode;
  readonly children: ReactNode;
}) {
  const [isAsking, setAsking] = useState(false);
  return (
    <>
      <Modal
        variant="drawer"
        title={title}
        isOpen={isOpen}
        isDismissable={false}
        isBusy={isBusy}
        onOpenChange={(open) => {
          if (open) return;
          if (isDirty) setAsking(true);
          else onClose();
        }}
        actions={actions}
        {...(footerStart === undefined ? {} : { footerStart })}
      >
        {children}
      </Modal>
      <Modal
        variant="confirm"
        tone="danger"
        title={strings.unsavedQuestion}
        isOpen={isAsking}
        onOpenChange={(open) => {
          if (!open) setAsking(false);
        }}
        actions={
          <>
            <Button slot="close">{strings.keepEditingForm}</Button>
            <Button
              variant="danger-solid"
              onPress={() => {
                setAsking(false);
                onClose();
              }}
            >
              {strings.discardForm}
            </Button>
          </>
        }
      >
        {strings.unsavedLine}
      </Modal>
      <LeaveGuard isDirty={isOpen && isDirty} searchStays />
    </>
  );
}
