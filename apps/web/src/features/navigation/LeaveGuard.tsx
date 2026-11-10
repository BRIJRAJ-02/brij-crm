// Brief
// Purpose: ask before leaving an editor with unsaved changes (the booking page editor, Availability, Profile), in a Modal like
// every other ending action (the owner's rule), not the browser's own confirm.
// Main task: Keep editing (Esc), or Leave without saving; or, where saving is one press (the booking page editor),
// Keep editing, Discard or Save, then go.
// Leaves out: closing the tab or reloading, which only the browser's own prompt can ask about (`enableBeforeUnload`).
import { Button, Modal } from '@crm/ui';
import { useBlocker } from '@tanstack/react-router';
import { useState } from 'react';
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
  /**
   * The question as save or discard (the booking page editor, 9 November 2026): one compact question with Discard
   * and Save (⌘↵). Save runs `onSave` and goes on once it answers true; a refused save stays, the editor saying why.
   */
  readonly save?: {
    readonly title: string;
    readonly text: string;
    readonly discardLabel?: string;
    readonly saveLabel?: string;
    readonly onSave: () => Promise<boolean>;
  };
}

/**
 * Blocks a navigation away while there are unsaved changes and asks in a danger Modal: Keep editing stays (Esc, a
 * click outside does nothing), Leave without saving goes on. Closing or reloading the tab asks the browser's way.
 */
export function LeaveGuard({ isDirty, searchStays = false, save }: LeaveGuardProps) {
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => isDirty && !(searchStays && current.pathname === next.pathname),
    enableBeforeUnload: () => isDirty,
    withResolver: true,
  });
  const [isSaving, setSaving] = useState(false);
  if (save !== undefined) {
    return (
      <Modal
        title={save.title}
        variant="confirm"
        isOpen={blocker.status === 'blocked'}
        isBusy={isSaving}
        onOpenChange={(isOpen) => {
          if (!isOpen && blocker.status === 'blocked' && !isSaving) blocker.reset();
        }}
        actions={
          <>
            <Button slot="close" variant="ghost" isDisabled={isSaving}>
              {strings.leaveStay}
            </Button>
            <Button
              isDisabled={isSaving}
              onPress={() => {
                if (blocker.status === 'blocked') blocker.proceed();
              }}
            >
              {save.discardLabel ?? strings.leaveDiscard}
            </Button>
            <Button
              variant="primary"
              isPending={isSaving}
              onPress={() => {
                setSaving(true);
                void save.onSave().then((isSaved) => {
                  setSaving(false);
                  if (blocker.status !== 'blocked') return;
                  if (isSaved) blocker.proceed();
                  else blocker.reset();
                });
              }}
            >
              {save.saveLabel ?? strings.leaveSave}
            </Button>
          </>
        }
      >
        {save.text}
      </Modal>
    );
  }
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
