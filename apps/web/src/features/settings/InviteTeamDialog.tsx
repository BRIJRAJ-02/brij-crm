// Brief
// Purpose: the Invite dialog from anywhere outside Settings › Members (Home's setup step, Round robin's empty state),
// so every Invite button opens the same form in place instead of leaving the page.
// Main task: read who may be invited as what once the dialog opens, then hand over to InviteDialog.
// Leaves out: the invitations list and the invite link (Settings › Members holds those).
import type { DataLayer, RoleOption } from '@crm/data';
import { useEffect, useState } from 'react';
import { InviteDialog } from './InviteDialog.tsx';
import { invitableRoles } from './members.ts';

/** No addresses yet. */
const NONE: ReadonlySet<string> = new Set();

/** What the dialog reads before it can show the form. */
interface Ready {
  readonly roles: readonly RoleOption[];
  readonly defaultRole: string;
  readonly memberEmails: ReadonlySet<string>;
  readonly invitedEmails: ReadonlySet<string>;
}

/** Props for InviteTeamDialog. */
export interface InviteTeamDialogProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** The server sent some: the page reads again what it shows of the team. */
  readonly onInvited?: () => void;
}

/**
 * Settings › Members' Invite dialog for a page that hasn't read the members:
 * on open it reads, through the data layer, the person's role, the
 * workspace's roles, the members and the open invitations (each cached by
 * the layer), showing the dialog loading meanwhile, then the same
 * InviteDialog. A failed read says so, with Try again.
 */
export function InviteTeamDialog({ data, slug, isOpen, onClose, onInvited }: InviteTeamDialogProps) {
  const [ready, setReady] = useState<Ready | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    let isCurrent = true;
    Promise.all([data.access.mine(slug), data.roles.list(slug), data.members.list(slug), data.invitations.list(slug)])
      .then(([access, roles, members, invitations]) => {
        if (!isCurrent) return;
        const allowed = invitableRoles(access.role);
        const options = roles.roles.filter((each) => each.builtIn !== undefined && allowed.includes(each.builtIn));
        setReady({
          roles: options,
          // New rows start as Member (the owner, 22 October 2026), whatever the workspace's default for joining.
          defaultRole: options.find((each) => each.builtIn === 'member')?.id ?? roles.defaultRole,
          memberEmails: new Set(
            members.flatMap((member) => (member.email === undefined ? [] : [member.email.toLowerCase()])),
          ),
          invitedEmails: new Set(invitations.filter((each) => !each.isExpired).map((each) => each.email.toLowerCase())),
        });
      })
      .catch(() => {
        if (isCurrent) setFailed(true);
      });
    return () => {
      isCurrent = false;
    };
  }, [data, slug, isOpen, attempt]);

  // Read again on the next open: who belongs and who is invited may have changed.
  const close = () => {
    setReady(undefined);
    setFailed(false);
    onClose();
  };

  // One dialog throughout: it opens loading, and the form fills in once the team is read.
  return (
    <InviteDialog
      data={data}
      slug={slug}
      isOpen={isOpen}
      onClose={close}
      roles={ready?.roles}
      defaultRole={ready?.defaultRole}
      memberEmails={ready?.memberEmails ?? NONE}
      invitedEmails={ready?.invitedEmails ?? NONE}
      read={
        ready === undefined
          ? {
              status: failed ? 'failed' : 'loading',
              onRetry: () => {
                setFailed(false);
                setAttempt(attempt + 1);
              },
            }
          : undefined
      }
      {...(onInvited === undefined ? {} : { onInvited })}
    />
  );
}
