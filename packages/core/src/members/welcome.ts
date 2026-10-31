// A new membership's welcome (26 Oct 2026, the owner: "we need to create link page automatically as soon as someone
// signs up and also mention"): their link page, made in the membership's own transaction, and the welcome email
// that says where it lives. Making a workspace, accepting an invitation and joining by the invite link all call it;
// an approved request to join makes the page here too (`ensureLinkPage`) and says so in its own approval email.
import type { WorkspaceTx } from '@crm/db';
import { ensureLinkPage } from '../booking/handles.ts';
import { queueWorkspaceWelcome } from '../emails/queue.ts';

/** Who just became a member, and the workspace's address for the email's links. */
export interface NewMembership {
  readonly memberId: string;
  readonly userId: string;
  readonly workspaceId: string;
  /** The workspace's address (`/w/<slug>`). */
  readonly slug: string;
  /** Their name in the workspace and their email: the handle starts from these. */
  readonly name: string;
  readonly email: string;
  /** They made the workspace (first run), rather than joining one: the welcome says so. */
  readonly created?: boolean;
  /** They joined as a guest (spec 0031, slice 9): no link page, as guests in Slack or Calendly have no profile (#77). */
  readonly isGuest?: boolean;
}

/** The link page editor's path in a workspace. */
export const linkPageEditPath = (slug: string): string => `/w/${slug}/link-page`;

/**
 * Makes the new member's link page and queues their welcome email, in the caller's transaction. Never throws: the
 * page runs under its own savepoint (`ensureLinkPage`), and so does the email, so a membership stands whatever
 * happens here. Answers the handle, or undefined when no page was made (the daily cleanup tries again), or for a
 * guest, who gets none.
 */
export async function welcomeMember(tx: WorkspaceTx, member: NewMembership): Promise<string | undefined> {
  const handle = member.isGuest === true ? undefined : await ensureLinkPage(tx, member);
  try {
    await tx.transaction((savepoint) =>
      queueWorkspaceWelcome(savepoint, {
        memberId: member.memberId,
        params: {
          openPath: `/w/${member.slug}`,
          ...(member.created === true ? { created: true } : {}),
          ...(handle === undefined ? {} : { linkPage: { handle, editPath: linkPageEditPath(member.slug) } }),
        },
      }),
    );
  } catch {
    // The welcome is a courtesy: the membership and its page stand without it.
  }
  return handle;
}
