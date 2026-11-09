// Brief
// Purpose: hold a switch of business (spec 0065 H7, AC-6517) while the screen in front has changes not yet saved.
// Main task: ask once, then either keep the person's edits or drop them and show the other business.
// Leaves out: leaving the page (LeaveGuard), and saving the changes for the person.
import type { HospitalityStore } from '@crm/data';
import { Button, Modal, useToasts } from '@crm/ui';
import { useEffect, useRef, useState } from 'react';
import { strings } from './strings.ts';

/** Props for SwitchGuard. */
export interface SwitchGuardProps {
  readonly store: HospitalityStore;
  readonly slug: string;
  /** Whether the screen holds changes a switch would drop. */
  readonly isDirty: boolean;
  /** Whether a save is on its way: a switch waits for it, refused with a word, rather than asking. */
  readonly isSaving?: boolean;
  /** What would be lost, in a sentence ("Your profile changes aren’t saved. Switching business drops them."). */
  readonly text: string;
}

/**
 * While `isDirty`, a switch of business from the sidebar or Settings › Business waits on this dialog: Keep editing
 * holds the business shown, Discard and switch goes on. While a save is on its way, a switch is refused with a toast.
 * Nothing at all while there are no changes.
 */
export function SwitchGuard({ store, slug, isDirty, isSaving = false, text }: SwitchGuardProps) {
  const toasts = useToasts();
  const [asking, setAsking] = useState<((go: boolean) => void) | undefined>();
  // Read when a switch is asked for, so the guard itself stays put while a save starts and ends.
  const isSavingNow = useRef(isSaving);
  useEffect(() => {
    isSavingNow.current = isSaving;
  }, [isSaving]);
  const isHeld = isDirty || isSaving;
  useEffect(() => {
    if (!isHeld) return undefined;
    let pending: ((go: boolean) => void) | undefined;
    const guard = () =>
      new Promise<boolean>((resolve) => {
        if (isSavingNow.current) {
          toasts.toast({ tone: 'info', message: strings.waitForSave });
          resolve(false);
          return;
        }
        pending = resolve;
        setAsking(() => resolve);
      });
    store.guardChoice(slug, guard);
    return () => {
      store.dropGuard(slug, guard);
      // Gone while asking (saved, or the page left): the switch waits for nothing.
      pending?.(false);
      setAsking(undefined);
    };
  }, [store, slug, isHeld, toasts]);
  const answer = (go: boolean) => {
    asking?.(go);
    setAsking(undefined);
  };
  if (asking === undefined) return null;
  return (
    <Modal
      title={strings.discardTitle}
      variant="confirm"
      tone="danger"
      isOpen
      onOpenChange={(open) => {
        if (!open) answer(false);
      }}
      actions={
        <>
          <Button slot="close">{strings.keepEditing}</Button>
          <Button variant="danger-solid" onPress={() => answer(true)}>
            {strings.discard}
          </Button>
        </>
      }
    >
      {text}
    </Modal>
  );
}
