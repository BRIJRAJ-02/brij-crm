// Brief
// Purpose: hand a page only person their own page (9 Nov 2026): Taylor invites Nick, who sets up a login and keeps
// timefix.com/nick, its blocks and its history.
// Main task: check or type their email, then Send invitation; or, with one already out, cancel it after a confirm.
// Leaves out: the role (they stay a Member), anything about the page itself, and partner people (their app's to give).
import { isDataError, type DataLayer, type TeamLinkPage } from '@crm/data';
import { Button, Callout, Field, Modal, sharedStrings } from '@crm/ui';
import { useRef, useState } from 'react';
import { teamStrings as strings } from './team-strings.ts';

/** A loose address check before anything is sent; the server checks it properly. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Props for Invite to manage their page. */
export interface PageInviteDialogProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The page only person, while the dialog is open. */
  readonly page: TeamLinkPage;
  readonly onClose: () => void;
  /** It went out (or stands unsent): the row's new invite, and whether its email left. */
  readonly onSent: (invite: NonNullable<TeamLinkPage['invite']>, sent: boolean) => void;
}

/**
 * A Modal with one Email field, filled from their open invitation, else the address they were given. Send invitation
 * sends once; a refusal on the address lands on the field, anything else above it. Mount it afresh for each opening.
 */
export function PageInviteDialog({ data, slug, page, onClose, onSent }: PageInviteDialogProps) {
  const [email, setEmail] = useState(page.invite?.email ?? page.email ?? '');
  // Once the address is edited, only Cancel or Esc throws it away (a stray click outside doesn't), as Add a page.
  const [isEdited, setEdited] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [isBusy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const send = () => {
    if (isBusy) return;
    const wanted = email.trim();
    const wrong =
      wanted === '' ? strings.inviteEmailMissing : EMAIL_SHAPE.test(wanted) ? undefined : strings.inviteEmailInvalid;
    if (wrong !== undefined) {
      setProblem(wrong);
      field.current?.focus();
      return;
    }
    setBusy(true);
    setProblem(undefined);
    setFailure(undefined);
    data.teamPages.invitePerson(slug, page.memberId, wanted).then(
      (answer) => {
        setBusy(false);
        onSent(answer.invite, answer.sent);
      },
      (error: unknown) => {
        setBusy(false);
        const message = isDataError(error) ? error.message : sharedStrings.couldntDoThat;
        if (isDataError(error) && (error.code === 'UNIQUE_CONFLICT' || error.code === 'CONFIG_INVALID')) {
          setProblem(message);
          field.current?.focus();
        } else {
          setFailure(message);
        }
      },
    );
  };
  return (
    <Modal
      title={strings.inviteTitle(page.name)}
      description={strings.inviteText}
      isOpen
      isDismissable={!isEdited}
      isBusy={isBusy}
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="primary" isPending={isBusy} onPress={send}>
            {isBusy ? strings.inviting : strings.inviteAction}
          </Button>
        </>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      <Field
        ref={field}
        label={strings.emailLabel}
        name="email"
        type="email"
        inputMode="email"
        // The one field, so it takes focus when the dialog opens.
        // eslint-disable-next-line jsx-a11y-x/no-autofocus
        autoFocus
        isRequired
        autoComplete="off"
        maxLength={254}
        value={email}
        isReadOnly={isBusy}
        {...(page.invite === undefined ? {} : { hint: strings.resendHint })}
        onChange={(next) => {
          setEmail(next);
          setEdited(true);
          setProblem(undefined);
        }}
        onSubmit={send}
        {...(problem === undefined ? {} : { error: problem })}
      />
    </Modal>
  );
}

/**
 * Asks before an open invitation is cancelled (the owner: anything that ends something asks first): a danger Modal
 * naming the address whose link stops, busy while the server works, its refusal inside. The last person asked about
 * stays while the Modal plays its exit.
 */
export function CancelPageInvite({
  data,
  slug,
  page,
  onClose,
  onCancelled,
}: {
  readonly data: DataLayer;
  readonly slug: string;
  readonly page: TeamLinkPage | undefined;
  readonly onClose: () => void;
  readonly onCancelled: (page: TeamLinkPage) => void;
}) {
  const [last, setLast] = useState(page);
  if (page !== undefined && page !== last) setLast(page);
  const [isBusy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const shown = page ?? last;
  if (shown === undefined) return null;
  const cancel = () => {
    if (isBusy) return;
    setBusy(true);
    setFailure(undefined);
    data.teamPages.cancelInvite(slug, shown.memberId).then(
      () => {
        setBusy(false);
        onCancelled(shown);
      },
      (error: unknown) => {
        setBusy(false);
        setFailure(isDataError(error) ? error.message : sharedStrings.couldntDoThat);
      },
    );
  };
  return (
    <Modal
      title={strings.revokeInviteTitle(shown.name)}
      variant="confirm"
      tone="danger"
      isOpen={page !== undefined}
      isBusy={isBusy}
      onOpenChange={(open) => {
        if (!open && !isBusy) {
          setFailure(undefined);
          onClose();
        }
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.keepInvite}
          </Button>
          <Button variant="danger-solid" isPending={isBusy} onPress={cancel}>
            {strings.revokeInvite}
          </Button>
        </>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      {strings.revokeInviteText(shown.invite?.email ?? '')}
    </Modal>
  );
}
