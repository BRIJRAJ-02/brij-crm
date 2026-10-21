// Brief
// Purpose: invite people to the workspace by email, with one role (spec 0031, AC-803).
// Main task: paste or type addresses, pick a role, Send invitations; refusals show in place, per address.
// Leaves out: the invite link and email domains (slice 6), and a seat line (until #38 sets plan limits).
import { isDataError, ROLE_DESCRIPTIONS, ROLE_LABELS, type DataLayer, type InviteResult, type Role } from '@crm/data';
import { Button, Field, Form, Modal, Select } from '@crm/ui';
import { useState } from 'react';
import { parseEmails } from './members.ts';
import { strings } from './members-strings.ts';

/** Props for the Invite dialog. */
export interface InviteDialogProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** The roles this person may invite as, most powerful first; the first that isn't owner is the default. */
  readonly roles: readonly Role[];
  /** The server sent them: the page says what happened and reads the invitations again. */
  readonly onInvited: (result: InviteResult) => void;
}

/** A refusal shown on the form: on the emails field, or above the fields. */
interface InviteRefusal {
  readonly code: string;
  readonly message: string;
  readonly field?: string;
}

/** The Invite dialog: a Modal holding a Form with the addresses and the role. */
export function InviteDialog({ data, slug, isOpen, onClose, roles, onInvited }: InviteDialogProps) {
  const [text, setText] = useState('');
  const [role, setRole] = useState<Role>(roles.includes('member') ? 'member' : (roles[0] ?? 'member'));
  const [isBusy, setBusy] = useState(false);
  const [refusals, setRefusals] = useState<readonly InviteRefusal[]>([]);

  const close = () => {
    if (isBusy) return;
    setText('');
    setRefusals([]);
    onClose();
  };

  const send = () => {
    const { emails, invalid } = parseEmails(text);
    const problems: InviteRefusal[] = [
      ...(emails.length === 0 && invalid.length === 0
        ? [{ code: 'MISSING', message: strings.noEmails, field: 'emails' }]
        : []),
      ...(invalid.length > 0
        ? [{ code: 'INVALID', message: strings.badEmails(invalid.join(', ')), field: 'emails' }]
        : []),
      ...(emails.length > 20 ? [{ code: 'TOO_MANY', message: strings.tooMany, field: 'emails' }] : []),
    ];
    setRefusals(problems);
    if (problems.length > 0) return;
    setBusy(true);
    data.invitations.create(slug, emails, role).then(
      (result) => {
        setBusy(false);
        setText('');
        onInvited(result);
      },
      (failure: unknown) => {
        setBusy(false);
        setRefusals([
          {
            code: isDataError(failure) ? failure.code : 'INTERNAL',
            message: isDataError(failure) ? failure.message : strings.somethingWrong,
          },
        ]);
      },
    );
  };

  return (
    <Modal
      title={strings.inviteTitle}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      // Typed addresses aren't thrown away by a stray click outside.
      isDismissable={text.trim() === ''}
      isBusy={isBusy}
    >
      <Form<InviteRefusal>
        submitLabel={strings.send}
        busyLabel={strings.sending}
        isBusy={isBusy}
        refusals={refusals}
        fieldFor={(refusal) => refusal.field}
        onSubmit={send}
        actions={
          <Button slot="close" kbd="ESC" isDisabled={isBusy} onPress={close}>
            {strings.cancel}
          </Button>
        }
      >
        <Field
          label={strings.emails}
          name="emails"
          isMultiline
          isRequired
          autoComplete="off"
          inputMode="email"
          placeholder={strings.emailsPlaceholder}
          hint={strings.emailsHint}
          value={text}
          onChange={setText}
        />
        <Select
          label={strings.role}
          items={roles.map((each) => ({ id: each, label: ROLE_LABELS[each], description: ROLE_DESCRIPTIONS[each] }))}
          value={role}
          onChange={(next) => {
            const chosen = roles.find((each) => each === next);
            if (chosen !== undefined) setRole(chosen);
          }}
          hint={ROLE_DESCRIPTIONS[role]}
        />
      </Form>
    </Modal>
  );
}
