// Brief
// Purpose: hold a switch of business (spec 0065 H7, AC-6517) while the screen in front has changes not yet saved.
// Main task: ask once, then either keep the person's edits or drop them and show the other business.
// Leaves out: leaving the page (LeaveGuard), and saving the changes for the person.
import type { HospitalityStore } from '@crm/data';
import { Button, Modal } from '@crm/ui';
import { useEffect, useState } from 'react';
import { strings } from './strings.ts';

/** Props for SwitchGuard. */
export interface SwitchGuardProps {
  readonly store: HospitalityStore;
  readonly slug: string;
  /** Whether the screen holds changes a switch would drop. */
  readonly isDirty: boolean;
  /** What would be lost, in a sentence ("Your profile changes aren’t saved. Switching business drops them."). */
  readonly text: string;
}

/**
 * While `isDirty`, a switch of business from the sidebar or Settings › Business waits on this dialog: Keep editing
 * holds the business shown, Discard and switch goes on. Nothing at all while there are no changes.
 */
export function SwitchGuard({ store, slug, isDirty, text }: SwitchGuardProps) {
  const [asking, setAsking] = useState<((go: boolean) => void) | undefined>();
  useEffect(() => {
    if (!isDirty) return undefined;
    store.guardChoice(slug, () => new Promise<boolean>((resolve) => setAsking(() => resolve)));
    return () => store.guardChoice(slug, undefined);
  }, [store, slug, isDirty]);
  const answer = (go: boolean) => {
    asking?.(go);
    setAsking(undefined);
  };
  if (asking === undefined) return null;
  return (
    <Modal
      title={strings.discardTitle}
      variant="confirm"
      isOpen
      onOpenChange={(open) => {
        if (!open) answer(false);
      }}
      actions={
        <>
          <Button slot="close">{strings.keepEditing}</Button>
          <Button variant="primary" onPress={() => answer(true)}>
            {strings.discard}
          </Button>
        </>
      }
    >
      {text}
    </Modal>
  );
}
