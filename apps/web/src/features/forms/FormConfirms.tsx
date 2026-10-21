// Brief
// Purpose: the confirms before a form ends something (the owner's rule, 21 October 2026): Delete, which can't be
// taken back, and Pause, which takes it offline until it is resumed.
// Main task: read the question and the one line on what happens, then Cancel, or the verb (Delete form, Pause form).
// Leaves out: Resume and turning a form on, which end nothing and stay one click.
import { isDataError, type DataLayer } from '@crm/data';
import { Button, Callout, Modal } from '@crm/ui';
import { useState } from 'react';
import { strings } from './strings.ts';

/** The form a confirm is about: enough to name it and say what goes with it. */
export interface ConfirmedForm {
  readonly id: string;
  readonly name: string;
  readonly submissionCount: number;
}

/** What the server answers a delete, and a pause. */
type Deleted = Awaited<ReturnType<DataLayer['forms']['delete']>>;
type Paused = Awaited<ReturnType<DataLayer['forms']['setStatus']>>;

/** Props for each confirm. */
interface FormConfirmProps<Done> {
  readonly data: DataLayer;
  readonly slug: string;
  /** The form asked about; undefined while the dialog is closed. */
  readonly form: ConfirmedForm | undefined;
  readonly onClose: () => void;
  /** The server agreed; the caller says so and moves on. */
  readonly onDone: (form: ConfirmedForm, done: Done) => void;
}

/**
 * The open dialog for one form: the commit shows busy while the server works,
 * and a refusal shows inside it, which stays open to try again or Cancel.
 */
function useCommit<Done>(
  form: ConfirmedForm | undefined,
  run: (form: ConfirmedForm) => Promise<Done>,
  onDone: (form: ConfirmedForm, done: Done) => void,
) {
  const [isBusy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  // The last form stays while the Modal plays its exit.
  const [last, setLast] = useState(form);
  if (form !== undefined && form !== last) {
    setLast(form);
    setFailure(undefined);
  }
  const commit = () => {
    if (isBusy || form === undefined) return;
    setBusy(true);
    setFailure(undefined);
    run(form).then(
      (done) => {
        setBusy(false);
        onDone(form, done);
      },
      (error: unknown) => {
        setBusy(false);
        setFailure(isDataError(error) ? error.message : strings.failedText);
      },
    );
  };
  return { shown: form ?? last, isBusy, failure, commit };
}

/** "Delete the Demo request form?": a danger confirm, Cancel (ESC) then Delete form. */
export function DeleteFormDialog({ data, slug, form, onClose, onDone }: FormConfirmProps<Deleted>) {
  const { shown, isBusy, failure, commit } = useCommit(form, (each) => data.forms.delete(slug, each.id), onDone);
  if (shown === undefined) return null;
  return (
    <Modal
      title={strings.deleteTitle(shown.name)}
      tone="danger"
      isOpen={form !== undefined}
      isBusy={isBusy}
      onOpenChange={(isOpen) => {
        if (!isOpen && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy} kbd="ESC">
            {strings.cancel}
          </Button>
          <Button variant="danger-solid" icon="trash" isPending={isBusy} onPress={commit}>
            {strings.deleteFormAction}
          </Button>
        </>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      <p>{strings.deleteText(shown.submissionCount)}</p>
    </Modal>
  );
}

/** "Pause the Demo request form?": a plain confirm (resuming undoes it), Cancel (ESC) then Pause form. */
export function PauseFormDialog({ data, slug, form, onClose, onDone }: FormConfirmProps<Paused>) {
  const { shown, isBusy, failure, commit } = useCommit(
    form,
    (each) => data.forms.setStatus(slug, each.id, 'paused'),
    onDone,
  );
  if (shown === undefined) return null;
  return (
    <Modal
      title={strings.pauseTitle(shown.name)}
      isOpen={form !== undefined}
      isBusy={isBusy}
      onOpenChange={(isOpen) => {
        if (!isOpen && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy} kbd="ESC">
            {strings.cancel}
          </Button>
          <Button variant="primary" icon="pause" isPending={isBusy} onPress={commit}>
            {strings.pauseAction}
          </Button>
        </>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      <p>{strings.pauseText}</p>
    </Modal>
  );
}
