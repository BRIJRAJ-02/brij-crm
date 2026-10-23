// Brief
// Purpose: ask before a change on the Members page that ends something (the owner, 21 October 2026): cancelling an
// invitation, declining a request, handing the workspace over, and turning off the invite link or company email.
// Main task: read what will happen, then the verb (or the way out); it closes once the server agrees.
// Leaves out: the change's own rules (the server's) and what the page says afterwards (the caller's toast).
import { isDataError } from '@crm/data';
import { Button, Callout, Modal } from '@crm/ui';
import { useState } from 'react';
import { strings } from './members-strings.ts';

/** One question: its title naming the thing, one sentence on what happens, the verb, and the change itself. */
export interface MemberQuestion {
  readonly title: string;
  readonly text: string;
  /** The commit's verb ("Cancel invitation"), never OK or Yes. */
  readonly action: string;
  /** The way out's words, when Cancel would clash with the verb ("Keep it" beside "Cancel invitation"). */
  readonly dismiss?: string;
  /** The change: resolves once the server agrees, throws its refusal otherwise. */
  readonly run: () => Promise<void>;
}

/** Props for the confirm. */
export interface MemberConfirmProps {
  /** The question asked now; undefined while closed. */
  readonly question: MemberQuestion | undefined;
  readonly onClose: () => void;
  /** The server agreed: the page says so and reads its lists again. */
  readonly onDone: () => void;
}

/**
 * A danger Modal (an alert dialog a click outside won't close): Cancel, or
 * the question's own way out (ESC), first, the danger solid verb last, busy while the server works, and its
 * refusal inside the dialog, which stays open.
 */
export function MemberConfirm({ question, onClose, onDone }: MemberConfirmProps) {
  // The last question stays while the Modal plays its exit.
  const [last, setLast] = useState(question);
  if (question !== undefined && question !== last) setLast(question);
  const shown = question ?? last;
  return shown === undefined ? null : (
    <Asked question={shown} isOpen={question !== undefined} onClose={onClose} onDone={onDone} />
  );
}

/** The open question, with its busy state and refusal. */
function Asked({
  question,
  isOpen,
  onClose,
  onDone,
}: {
  readonly question: MemberQuestion;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onDone: () => void;
}) {
  const [isBusy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const commit = () => {
    if (isBusy) return;
    setBusy(true);
    setFailure(undefined);
    question.run().then(
      () => {
        setBusy(false);
        onDone();
      },
      (error: unknown) => {
        setBusy(false);
        setFailure(isDataError(error) ? error.message : strings.somethingWrong);
      },
    );
  };
  return (
    <Modal
      title={question.title}
      tone="danger"
      isOpen={isOpen}
      isBusy={isBusy}
      onOpenChange={(open) => {
        if (!open && !isBusy) {
          setFailure(undefined);
          onClose();
        }
      }}
      actions={
        <>
          <Button slot="close" kbd="ESC" isDisabled={isBusy}>
            {question.dismiss ?? strings.cancel}
          </Button>
          <Button variant="danger-solid" isPending={isBusy} onPress={commit}>
            {question.action}
          </Button>
        </>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      {question.text}
    </Modal>
  );
}
