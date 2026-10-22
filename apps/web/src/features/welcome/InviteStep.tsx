// Brief
// Purpose: first run's Invite your team (spec 0036, spec 0031's invitations): bring colleagues in while the workspace is new.
// Main task: an address per row (the plus or Enter adds the next, a pasted list splits into rows), each with its role
// where roles were read, then Send invites, or Skip for now; then on to the calendar step or the workspace.
// Leaves out: the list of open invitations and the invite link (Settings › Members holds those).
import type { DataLayer, RoleOption } from '@crm/data';
import { Button, Callout, InviteRows } from '@crm/ui';
import { useEffect, useRef } from 'react';
import { useInvite } from '../settings/useInvite.tsx';
import { strings } from './strings.ts';

/** Props for Invite your team. */
export interface InviteStepProps {
  readonly data: DataLayer;
  /** The workspace just made, by its address. */
  readonly slug: string;
  /** The roles its maker may invite as, and the one rows start with; undefined when unread (everyone as a member). */
  readonly roles?: { readonly roles: readonly RoleOption[]; readonly defaultRole: string } | undefined;
  /** On to the next step, or into the workspace. */
  readonly onDone: () => void;
}

/**
 * Invite your team: the one invite form (Settings › Members' rows, `useInvite`
 * with InviteRows), Send invites and Skip for now. Once sent, what went out
 * (and any address already in, or not mailed) and Continue.
 */
export function InviteStep({ data, slug, roles, onDone }: InviteStepProps) {
  const invite = useInvite({
    data,
    slug,
    roles: roles?.roles,
    defaultRole: roles?.defaultRole,
    noEmails: strings.noEmails,
  });
  const { sent, isBusy, failure } = invite;
  const next = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (sent !== undefined) next.current?.focus();
  }, [sent]);

  if (sent !== undefined) {
    return (
      <>
        <Callout
          tone={sent.invited.length > 0 ? 'success' : 'info'}
          title={strings.invited(sent.invited.length)}
          isAnnounced
        >
          {[
            ...(sent.refused.length > 0
              ? [strings.inviteRefused(sent.refused.map((each) => each.email).join(', '))]
              : []),
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
    <>
      {failure !== undefined && (
        <Callout tone="danger" isAnnounced>
          {failure}
        </Callout>
      )}
      <InviteRows {...invite.rowsProps} />
      <Button variant="primary" size="lg" isFullWidth="center" isPending={isBusy} onPress={invite.send}>
        {isBusy ? strings.sendingInvites : strings.sendInvites}
      </Button>
      <Button variant="ghost" size="lg" isFullWidth="center" isDisabled={isBusy} onPress={onDone}>
        {strings.skipCalendar}
      </Button>
    </>
  );
}
