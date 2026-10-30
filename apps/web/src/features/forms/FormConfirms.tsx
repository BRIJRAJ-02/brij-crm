// Brief
// Purpose: the confirms before a form ends something (the owner's rule, 21 October 2026): Delete, which can't be
// taken back, Pause, which takes it offline until it is resumed, Rotate secret, which stops the old one at once, and
// Remove site, which stops that site's own HTML posting.
// Main task: read the question and the one line on what happens, then Cancel, or the verb (Delete form, Pause form).
// Leaves out: Resume and turning a form on, which end nothing and stay one click.
// Also here: the confirm before a form's object changes, which clears where every question is saved.
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

/** "Delete “Demo request”?": a danger confirm, Cancel (ESC) then Delete form. */
export function DeleteFormDialog({ data, slug, form, onClose, onDone }: FormConfirmProps<Deleted>) {
  const { shown, isBusy, failure, commit } = useCommit(form, (each) => data.forms.delete(slug, each.id), onDone);
  if (shown === undefined) return null;
  return (
    <Modal
      title={strings.deleteTitle(shown.name)}
      variant="confirm"
      tone="danger"
      isOpen={form !== undefined}
      isBusy={isBusy}
      onOpenChange={(isOpen) => {
        if (!isOpen && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
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

/** What the server answers a new secret. */
type Rotated = Awaited<ReturnType<DataLayer['forms']['rotateSecret']>>;

/** "Rotate the signing secret?": a danger confirm (the old secret stops at once), Cancel (ESC) then Rotate secret. */
export function RotateSecretDialog({ data, slug, form, onClose, onDone }: FormConfirmProps<Rotated>) {
  const { shown, isBusy, failure, commit } = useCommit(form, (each) => data.forms.rotateSecret(slug, each.id), onDone);
  if (shown === undefined) return null;
  return (
    <Modal
      title={strings.secretRotateTitle}
      variant="confirm"
      tone="danger"
      isOpen={form !== undefined}
      isBusy={isBusy}
      onOpenChange={(isOpen) => {
        if (!isOpen && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="danger-solid" icon="refresh-cw" isPending={isBusy} onPress={commit}>
            {strings.secretRotateAction}
          </Button>
        </>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      <p>{strings.secretRotateText}</p>
    </Modal>
  );
}

/** Props for the Remove site confirm. */
interface RemoveSiteDialogProps {
  /** The site asked about; undefined while the dialog is closed. */
  readonly site: string | undefined;
  /** Saves the list without it; a refusal rejects, and the dialog says it. */
  readonly onRemove: (site: string) => Promise<unknown>;
  readonly onClose: () => void;
}

/** "Remove acme.com?": a danger confirm (its own HTML stops posting at once), Cancel (ESC) then Remove site. */
export function RemoveSiteDialog({ site, onRemove, onClose }: RemoveSiteDialogProps) {
  const [isBusy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  // The last site stays while the Modal plays its exit.
  const [last, setLast] = useState(site);
  if (site !== undefined && site !== last) {
    setLast(site);
    setFailure(undefined);
  }
  const shown = site ?? last;
  if (shown === undefined) return null;
  const commit = () => {
    if (isBusy || site === undefined) return;
    setBusy(true);
    setFailure(undefined);
    onRemove(site).then(
      () => {
        setBusy(false);
        onClose();
      },
      (error: unknown) => {
        setBusy(false);
        setFailure(isDataError(error) ? error.message : strings.failedText);
      },
    );
  };
  return (
    <Modal
      title={strings.siteRemoveTitle(shown)}
      variant="confirm"
      tone="danger"
      isOpen={site !== undefined}
      isBusy={isBusy}
      onOpenChange={(isOpen) => {
        if (!isOpen && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="danger-solid" icon="x" isPending={isBusy} onPress={commit}>
            {strings.siteRemoveAction}
          </Button>
        </>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      <p>{strings.siteRemoveText}</p>
    </Modal>
  );
}

/** What a retarget would lose: how many questions are saved onto the object now, its name, and the one it moves to. */
export interface RetargetAsk {
  /** The object asked for; null turns saving to the CRM off. */
  readonly objectId: string | null;
  readonly filedCount: number;
  readonly objectName: string;
  /** The object asked for, by name; unused when `objectId` is null. */
  readonly nextName: string;
}

/** Props for the object change confirm. */
interface RetargetDialogProps {
  /** What is being asked; undefined while the dialog is closed. */
  readonly ask: RetargetAsk | undefined;
  readonly onClose: () => void;
  readonly onConfirm: (objectId: string | null) => void;
}

/**
 * "Change where submissions are saved?": the questions saved onto the object
 * now lose where they are saved, and a change can't be taken back, so it is
 * confirmed like the other endings. Only asked when something would be lost:
 * with no question saved anywhere, the change stays one click.
 *
 * Unlike the confirms above, it closes as soon as it is answered rather than
 * waiting for the server. The change is the page's own save (flush, then the
 * new target, then the object's fields), so its progress shows on the
 * Settings card behind (`isBusy`), and a refusal comes back as that page's
 * toast or its "changed by someone else" notice. Keeping the dialog open
 * would hold Esc for the whole round trip with nothing more to say in it.
 */
export function RetargetFormDialog({ ask, onClose, onConfirm }: RetargetDialogProps) {
  const [last, setLast] = useState<RetargetAsk | undefined>(undefined);
  if (ask !== undefined && ask !== last) setLast(ask);
  const shown = ask ?? last;
  if (shown === undefined) return null;
  return (
    <Modal
      title={shown.objectId === null ? strings.retargetOffTitle : strings.retargetTitle}
      variant="confirm"
      tone="danger"
      isOpen={ask !== undefined}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      actions={
        <>
          <Button slot="close">{strings.cancel}</Button>
          <Button
            variant="danger-solid"
            icon={shown.objectId === null ? 'x' : 'refresh-cw'}
            onPress={() => {
              onConfirm(shown.objectId);
              onClose();
            }}
          >
            {shown.objectId === null ? strings.retargetOffAction : strings.retargetAction}
          </Button>
        </>
      }
    >
      <p>
        {shown.objectId === null
          ? strings.retargetOffText(shown.filedCount, shown.objectName)
          : strings.retargetText(shown.filedCount, shown.objectName, shown.nextName)}
      </p>
    </Modal>
  );
}
