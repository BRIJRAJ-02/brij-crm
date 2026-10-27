// Brief
// Purpose: first run's Invite your team (spec 0036, spec 0031's invitations): bring colleagues in while the workspace is new.
// Main task: an address per row (the plus or Enter adds the next, a pasted list splits into rows), each with its role
// where roles were read, then Invite ("Invite 2 people"), or Skip for now; then on to the calendar step or the workspace.
// Leaves out: the list of open invitations and the invite link (Settings › Members holds those).
// Also says, once, where the link page made with the workspace will be (26 Oct 2026), private until they act, with Edit.
import type { DataLayer, RoleOption } from '@crm/data';
import { Button, ButtonLink, Callout, Form, InviteRows } from '@crm/ui';
import { useEffect, useRef } from 'react';
import { strings as inviteStrings } from '../settings/members-strings.ts';
import { useInvite } from '../settings/useInvite.tsx';
import { publicProfileUrl } from '../booking/links.ts';
import { linkPageHref } from '../workspace/objects.ts';
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
  /** The handle of the link page made with the workspace; undefined when there is none (yet) or it wasn't read. */
  readonly handle?: string | undefined;
}

/**
 * The link page made with the workspace: its address and Edit link page in a new tab, so first run stays where it is
 * (what was typed, and the steps still to come). Private until they edit it or share it (27 Oct 2026), so there is
 * no Copy link: the address would open nothing for whoever it was sent to.
 */
function LinkPageReady({ handle, slug }: { readonly handle: string; readonly slug: string }) {
  const address = publicProfileUrl(handle);
  return (
    <Callout
      tone="info"
      title={strings.linkPageReady}
      actions={
        <ButtonLink variant="ghost" href={linkPageHref(slug)} isExternal icon="arrow-up-right">
          {strings.linkPageEdit}
        </ButtonLink>
      }
    >
      {strings.linkPageAt} <strong>{address.replace(/^https?:\/\//, '')}</strong>. {strings.linkPageNext}
    </Callout>
  );
}

/**
 * Invite your team: the one invite form (Settings › Members' rows, `useInvite`
 * with InviteRows), Invite ("Invite 2 people", as in the dialog) and Skip for now. Once sent, what went out
 * (and any address already in, or not mailed) and Continue.
 */
export function InviteStep({ data, slug, roles, onDone, handle }: InviteStepProps) {
  const invite = useInvite({
    data,
    slug,
    roles: roles?.roles,
    defaultRole: roles?.defaultRole,
    noEmails: strings.noEmails,
  });
  const { sent, isBusy, failure, notice, valid } = invite;
  const next = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (sent !== undefined) next.current?.focus();
  }, [sent]);

  const linkPage = handle === undefined ? undefined : <LinkPageReady handle={handle} slug={slug} />;

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
    <Form
      // The same words as Settings › Members' dialog: one way to add people ("Invite 2 people", "Inviting").
      submitLabel={inviteStrings.inviteCount(valid.length)}
      busyLabel={inviteStrings.sending}
      isBusy={isBusy}
      refusals={failure === undefined ? [] : [{ code: 'INVITE', message: failure }]}
      onSubmit={invite.send}
      actions={
        <Button variant="ghost" size="lg" isFullWidth="center" isDisabled={isBusy} onPress={onDone}>
          {strings.skipCalendar}
        </Button>
      }
    >
      {notice !== undefined && <Callout isAnnounced>{notice}</Callout>}
      <InviteRows {...invite.rowsProps} />
      {linkPage}
    </Form>
  );
}
