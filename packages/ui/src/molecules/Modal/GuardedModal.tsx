// GuardedModal (spec 0073, AC-7307): a Modal that asks before it throws away unsaved changes. Its own file and
// export, so only a screen that guards a form loads the confirm; every other Modal (on every route) carries none of it.
import { use, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DialogContext, OverlayTriggerStateContext } from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import { guardStrings as strings } from './guard-strings.ts';
import { Modal, type ModalProps } from './Modal.tsx';

/** Props for GuardedModal: every Modal prop, and whether the form inside holds changes not yet saved. */
export interface GuardedModalProps extends ModalProps {
  /**
   * The form inside holds changes not yet saved (the prototype's Drawer guard). While true, a close asked by the close
   * button, Esc, a `slot="close"` button or a click outside opens the house confirm, "Discard your unsaved changes?",
   * and only Discard changes closes; Keep editing (or Esc) puts focus back in the form. A Save that clears it and
   * closes in the same handler closes without asking; the confirm goes away by itself when it turns false (an
   * autosave) or the Modal is closed by its caller.
   */
  readonly isDirty: boolean;
}

/**
 * A Modal holding a form that asks before a close throws its changes away. Works controlled (`isOpen` and
 * `onOpenChange`) or inside a ModalTrigger, whose open state it then answers itself.
 */
export function GuardedModal({ isDirty, isOpen, onOpenChange, ...props }: GuardedModalProps) {
  // A close asked while the form holds unsaved changes: `pending` until this render's `isDirty` is known (a Save
  // that clears the form and closes in one handler has cleared it by then, and closes without asking), then
  // `asking` while the discard confirm waits for its answer.
  const [discard, setDiscard] = useState<'idle' | 'pending' | 'asking'>('idle');
  // Inside a ModalTrigger the trigger's state would close the overlay without asking, so the guard takes that state
  // over: it shows what the trigger says and answers every close itself.
  const triggerState = use(OverlayTriggerStateContext);
  const viaTrigger = isOpen === undefined && triggerState !== null ? triggerState : undefined;
  const shownOpen = viaTrigger === undefined ? isOpen : viaTrigger.isOpen;
  const changeOpen = (open: boolean) => {
    if (viaTrigger === undefined) onOpenChange?.(open);
    else viaTrigger.setOpen(open);
  };
  const answerOpenChange = (open: boolean) => {
    if (!open && isDirty) setDiscard('pending');
    else changeOpen(open);
  };
  // The confirm answers a close only while it still applies: the form still holds changes and the Modal is still
  // open. Otherwise it is dropped, so it never pops up later with nobody asking. These follow from this render's
  // props, so they are settled here as React does for state derived from props, not in an effect.
  const isClosed = shownOpen === false;
  // Each close that turned out to have nothing to lose (a Save that cleared the form in the same handler), counted,
  // so the effect below closes once per such close.
  const [cleanCloses, setCleanCloses] = useState(0);
  if (discard !== 'idle' && isClosed) setDiscard('idle');
  else if (discard === 'pending' && isDirty) setDiscard('asking');
  else if (discard === 'pending') {
    setDiscard('idle');
    setCleanCloses((count) => count + 1);
  } else if (discard === 'asking' && !isDirty) setDiscard('idle');
  const close = useRef(changeOpen);
  useLayoutEffect(() => {
    close.current = changeOpen;
  });
  useEffect(() => {
    if (cleanCloses > 0) close.current(false);
  }, [cleanCloses]);
  return (
    <>
      <Modal {...props} {...(shownOpen === undefined ? {} : { isOpen: shownOpen })} onOpenChange={answerOpenChange} />
      {/* Its own dialog, not the ModalTrigger's: the trigger's DialogContext would hand it the main dialog's id. Always
          mounted, so a confirm whose changes went meanwhile (an autosave landing) leaves over its exit, not at once. */}
      <DialogContext value={null}>
        <Modal
          title={strings.discardTitle}
          variant="confirm"
          tone="danger"
          isOpen={discard === 'asking' && !isClosed && isDirty}
          onOpenChange={(open) => {
            if (!open) setDiscard('idle');
          }}
          actions={
            <>
              <Button slot="close">{strings.keepEditing}</Button>
              <Button
                variant="danger-solid"
                onPress={() => {
                  setDiscard('idle');
                  changeOpen(false);
                }}
              >
                {strings.discardChanges}
              </Button>
            </>
          }
        />
      </DialogContext>
    </>
  );
}
