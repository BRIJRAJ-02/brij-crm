// Brief
// Purpose: invite people to the workspace by email, each with a role (spec 0031, AC-803).
// Main task: type an address per row (+ Add another, or Enter, makes the next; a pasted list splits into rows), pick
// each row's role where it differs, then Invite; the dialog then says who was invited.
// Leaves out: the invite link's settings (the Joining tab's Other ways to join; the foot only copies it, turning it on
// as a Member link when off, with Undo), email domains, and a seat line (until #38 sets limits).
import { isDataError, type DataLayer, type InviteLinkView, type RoleOption } from '@crm/data';
import { Button, Callout, Disclosure, InviteRows, Modal, Skeleton, useDelayedLoading } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { strings } from './members-strings.ts';
import { hasGuide, RoleGuide } from './RoleGuide.tsx';
import { useInvite } from './useInvite.tsx';

/** Props for the Invite dialog. */
export interface InviteDialogProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /**
   * The roles this person may invite as, from the workspace's roles list
   * (`roles.list`, spec 0037, AC-1439), most power first, each with its line
   * on what it can do.
   */
  readonly roles: readonly RoleOption[] | undefined;
  /** The role new rows start with unless someone picks another: Member's id, when the list has Member. */
  readonly defaultRole: string | undefined;
  /**
   * While the team is still being read (InviteTeamDialog): the dialog is
   * already open, loading or saying the read failed with Try again, so it
   * opens once and the form fills in.
   */
  readonly read?: { readonly status: 'loading' | 'failed'; readonly onRetry: () => void } | undefined;
  /**
   * Addresses of members the page has read (lowercase): a row holding one is refused before anything is sent.
   * Best effort, as the list is paged; the server still refuses anyone else who belongs, in the sent summary.
   */
  readonly memberEmails: ReadonlySet<string>;
  /** Addresses with a live invitation waiting (lowercase; expired ones can be sent again): refused the same way. */
  readonly invitedEmails: ReadonlySet<string>;
  /** The server sent some: the page reads the invitations again. */
  readonly onInvited?: () => void;
}

/**
 * The Invite dialog: the one invite form (`useInvite` with the library's
 * InviteRows), a row per person with that row's role, what each role can do
 * in the tip by the Role column and in full under the rows (What each role can do), "+ Add another" under them. An address
 * that already belongs or is already invited is refused in its row before
 * anything is sent. Invite sends every valid row, one call per role; the
 * dialog then says who was invited, who already belongs, and whose email
 * didn't go out. Every Invite button in the app opens this dialog
 * (`InviteTeamDialog` where the page hasn't read the members).
 */
export function InviteDialog({
  data,
  slug,
  isOpen,
  onClose,
  roles,
  defaultRole,
  memberEmails,
  invitedEmails,
  onInvited,
  read,
}: InviteDialogProps) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const invite = useInvite({ data, slug, roles, defaultRole, memberEmails, invitedEmails, onInvited });
  const { sent, isBusy, failure, notice, valid } = invite;
  // Copy invite link (the foot): one press copies the workspace's link, turning it on as a Member link when it is
  // off (Undo turns it off again), rather than asking first (the owner, 30 October 2026: act, don't ask).
  const [isCopying, setCopying] = useState(false);
  const failed = (error: unknown) => {
    toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.somethingWrong });
  };
  const copy = (link: InviteLinkView, turnedOn: boolean) => {
    if (link.token === undefined) return;
    const url = new URL(`/invite/${link.token}`, globalThis.location.origin).href;
    navigator.clipboard.writeText(url).then(
      () => {
        toasts.toast(
          turnedOn
            ? {
                tone: 'success',
                message: strings.inviteLinkOnCopied,
                action: {
                  label: strings.undo,
                  onAction: () => {
                    data.invitations.setLink(slug, { enabled: false }).catch(failed);
                  },
                },
              }
            : { tone: 'success', message: strings.inviteLinkCopied },
        );
      },
      () => {
        toasts.toast({ tone: 'danger', message: strings.inviteLinkCopyFailed });
      },
    );
  };
  /** Reads the link fresh (another admin may have changed it), turns it on when off, then copies it. */
  const copyLink = () => {
    if (isCopying) return;
    setCopying(true);
    data.invitations
      .link(slug)
      .then(async (link) => {
        if (link.enabled && link.isSpent) {
          toasts.toast({ tone: 'info', message: strings.inviteLinkSpent });
          return;
        }
        if (link.enabled) copy(link, false);
        // Off: a Member link with no expiry or cap, the server's default.
        else copy(await data.invitations.setLink(slug, { enabled: true }), true);
      })
      .catch(failed)
      .finally(() => {
        setCopying(false);
      });
  };
  // The team is usually read already, so the skeleton shows only for a slow read.
  const isSlow = useDelayedLoading(isOpen && read?.status === 'loading');

  const close = () => {
    if (isBusy) return;
    invite.reset();
    onClose();
  };

  if (sent !== undefined) {
    return (
      <Modal
        title={strings.inviteTitle}
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        actions={
          <>
            <Button onPress={invite.reset}>{strings.inviteMore}</Button>
            <Button
              variant="primary"
              slot="close"
              // The Invite button went with the change: focus waits on Done, the way out.
              // eslint-disable-next-line jsx-a11y-x/no-autofocus
              autoFocus
            >
              {strings.done}
            </Button>
          </>
        }
      >
        {sent.invited.length > 0 && (
          <Callout tone="success" isAnnounced>
            {strings.sentTo(sent.invited.map((each) => each.email).join(', '))}
          </Callout>
        )}
        {sent.refused.length > 0 && (
          <Callout isAnnounced>{strings.alreadyMembers(sent.refused.map((each) => each.email).join(', '))}</Callout>
        )}
        {sent.unsent.length > 0 && <Callout tone="danger">{strings.unsent(sent.unsent.join(', '))}</Callout>}
      </Modal>
    );
  }

  if (read !== undefined) {
    return (
      <Modal
        title={strings.inviteTitle}
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        actions={
          <>
            <Button slot="close" kbd="ESC">
              {strings.cancel}
            </Button>
            {read.status === 'failed' && (
              <Button variant="primary" onPress={read.onRetry}>
                {strings.inviteTryAgain}
              </Button>
            )}
          </>
        }
      >
        {read.status === 'failed' ? (
          <Callout tone="danger" isAnnounced>
            {strings.inviteLoadFailed}
          </Callout>
        ) : (
          isSlow && <Skeleton lines={2} />
        )}
      </Modal>
    );
  }

  return (
    <Modal
      title={strings.inviteTitle}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      // Typed addresses aren't thrown away by a stray click outside.
      isDismissable={invite.isEmpty}
      isBusy={isBusy}
      // A quiet second way in: the workspace's link, for people whose address isn't known (Attio has it here too).
      hint={
        <Button variant="ghost" icon="link" isPending={isCopying} onPress={copyLink}>
          {strings.copyInviteLink}
        </Button>
      }
      actions={
        <>
          <Button slot="close" kbd="ESC" isDisabled={isBusy} onPress={close}>
            {strings.cancel}
          </Button>
          <Button variant="primary" isPending={isBusy} onPress={invite.send}>
            {isBusy ? strings.sending : strings.inviteCount(valid.length)}
          </Button>
        </>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      {notice !== undefined && <Callout isAnnounced>{notice}</Callout>}
      <InviteRows
        {...invite.rowsProps}
        // The dialog opens to invite: its first email is what the press asked for.
        // eslint-disable-next-line jsx-a11y-x/no-autofocus
        autoFocus
      />
      {/* What each role can do, one press away: closed, so the dialog stays the invite it was opened for. */}
      {roles !== undefined && hasGuide(roles) && (
        <Disclosure title={strings.roleGuide} variant="quiet">
          <RoleGuide roles={roles} initialRole={defaultRole} />
        </Disclosure>
      )}
    </Modal>
  );
}
