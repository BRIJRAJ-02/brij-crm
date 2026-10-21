// Brief
// Purpose: first run's Invite your team (spec 0036, spec 0031's invitations): bring colleagues in while the workspace is new.
// Main task: paste a few addresses and Send invites, or Skip for now; then on to the calendar step or the workspace.
// Leaves out: roles (everyone joins as a member; Settings › Members changes it), and the list of open invitations.
import { isDataError, type DataLayer } from '@crm/data';
import { Button, Callout, Field, Form } from '@crm/ui';
import { useEffect, useRef, useState } from 'react';
import { parseEmails } from '../settings/members.ts';
import type { WelcomeRefusal } from './refusals.ts';
import { strings } from './strings.ts';

const EMAILS = 'emails';

/** The most addresses one invite takes (the server's limit). */
const MOST = 20;

/** What the last invite did, said above Continue. */
interface Sent {
  readonly count: number;
  readonly refused: readonly string[];
  readonly unsent: readonly string[];
}

/** Props for Invite your team. */
export interface InviteStepProps {
  readonly data: DataLayer;
  /** The workspace just made, by its address. */
  readonly slug: string;
  /** On to the next step, or into the workspace. */
  readonly onDone: () => void;
}

/**
 * Invite your team: "Emails" (commas, spaces or new lines between them),
 * Send invites (everyone as a member) and Skip for now. Once sent, what went
 * out (and any address already in, or not mailed) and Continue.
 */
export function InviteStep({ data, slug, onDone }: InviteStepProps) {
  const [text, setText] = useState('');
  const [isBusy, setBusy] = useState(false);
  const [refusals, setRefusals] = useState<readonly WelcomeRefusal[]>([]);
  const [sent, setSent] = useState<Sent | undefined>(undefined);
  const next = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (sent !== undefined) next.current?.focus();
  }, [sent]);

  const send = () => {
    const { emails, invalid } = parseEmails(text);
    const problems: WelcomeRefusal[] = [
      ...(emails.length === 0 && invalid.length === 0
        ? [{ code: 'MISSING', message: strings.noEmails, field: EMAILS }]
        : []),
      ...(invalid.length > 0
        ? [{ code: 'INVALID', message: strings.badEmails(invalid.join(', ')), field: EMAILS }]
        : []),
      ...(emails.length > MOST ? [{ code: 'TOO_MANY', message: strings.tooManyEmails, field: EMAILS }] : []),
    ];
    setRefusals(problems);
    if (problems.length > 0) return;
    setBusy(true);
    data.invitations.create(slug, emails, 'member').then(
      (result) => {
        setBusy(false);
        setSent({
          count: result.invited.length,
          refused: result.refused.map((each) => each.email),
          unsent: result.unsent,
        });
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

  if (sent !== undefined) {
    return (
      <>
        <Callout tone={sent.count > 0 ? 'success' : 'info'} title={strings.invited(sent.count)} isAnnounced>
          {[
            ...(sent.refused.length > 0 ? [strings.inviteRefused(sent.refused.join(', '))] : []),
            ...(sent.unsent.length > 0 ? [strings.inviteUnsent(sent.unsent.join(', '))] : []),
            strings.invitedText,
          ].join(' ')}
        </Callout>
        <Button ref={next} variant="primary" size="lg" isFullWidth="center" onPress={onDone}>
          {strings.continue}
        </Button>
      </>
    );
  }

  return (
    <Form<WelcomeRefusal>
      submitLabel={strings.sendInvites}
      busyLabel={strings.sendingInvites}
      isBusy={isBusy}
      refusals={refusals}
      fieldFor={(refusal) => refusal.field}
      onSubmit={send}
      actions={
        <Button variant="ghost" size="lg" isFullWidth="center" isDisabled={isBusy} onPress={onDone}>
          {strings.skipCalendar}
        </Button>
      }
    >
      <Field
        label={strings.inviteEmails}
        name={EMAILS}
        isMultiline
        placeholder={strings.invitePlaceholder}
        hint={strings.inviteHint}
        value={text}
        onChange={setText}
      />
    </Form>
  );
}
