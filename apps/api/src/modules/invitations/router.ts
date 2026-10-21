import { INVITE_SENDS_PER_INVITER_HOUR, INVITE_SENDS_PER_WORKSPACE_HOUR } from '@crm/contracts';
import {
  getInviteLink,
  inviteMembers,
  listInvitations,
  setInviteLink,
  resendInvite,
  revokeInvite,
  type InviteSender,
  type SentInvitation,
} from '@crm/core';
import { renderMemberInvite, type RenderedEmail } from '@crm/emails';
import { apiError } from '../../errors.ts';
import { commitWrite } from '../../hooks.ts';
import { errorFields, log } from '../../log.ts';
import { captureFault } from '../../monitoring/sentry.ts';
import { member, type RequestContext } from '../../orpc.ts';
import { sourceOf } from '../../source.ts';
import { invitationsPublic } from './public.ts';

// Invitations (spec 0031, slice 2). Inside a workspace for those who invite (the door, then `members.invite` in
// core). `peek` and `accept` are bootstrap, in public.ts: core finds the workspace by the token's hash and mints its
// scope there, so nothing here builds one.

/** Whole minutes, at least one, for a message. */
const minutes = (seconds: number) => Math.max(1, Math.ceil(seconds / 60));

const HOUR = 3600;

/** What a spent send limit answers: 429 `RATE_LIMITED`, with the wait in whole minutes. */
function sendsSpent(retryAfterSeconds: number | undefined): Error {
  return apiError(
    'RATE_LIMITED',
    `Too many invitations went out in the last hour. Try again in ${String(minutes(retryAfterSeconds ?? HOUR))} minutes.`,
  );
}

/**
 * Counts `sends` invitation emails against the inviter's hour and then the
 * workspace's (AC-808), refusing 429 `RATE_LIMITED` with the wait once either
 * is spent. The inviter is the signed in person, across every workspace they
 * invite from, so making more workspaces never makes more sends. Their own
 * limit comes first, so someone over it spends none of the workspace's. Core
 * calls it once the caller may invite and before it writes, so a refused
 * caller spends nothing, and a write refused later (a full plan) still used
 * them.
 */
async function limitSends(
  context: Pick<RequestContext, 'limiter'>,
  workspaceId: string,
  userId: string,
  sends: number,
): Promise<void> {
  const inviter = await context.limiter.consumeRateLimit(
    `invites:inviter:${userId}`,
    { window: HOUR, max: INVITE_SENDS_PER_INVITER_HOUR },
    sends,
  );
  if (!inviter.allowed) throw sendsSpent(inviter.retryAfterSeconds);
  const workspace = await context.limiter.consumeRateLimit(
    `invites:workspace:${workspaceId}`,
    { window: HOUR, max: INVITE_SENDS_PER_WORKSPACE_HOUR },
    sends,
  );
  if (!workspace.allowed) throw sendsSpent(workspace.retryAfterSeconds);
}

/** Who the email says invited them when no member did (the system, in tests): never an empty name. */
const NO_INVITER = 'A teammate';

/**
 * One invitation's email (spec 0031, AC-803): `@crm/emails`' invite
 * template, its accept link the app path carrying the raw token, drawn into
 * the email here and never stored or logged.
 */
function inviteEmail(
  context: Pick<RequestContext, 'appUrl'>,
  sender: InviteSender,
  each: SentInvitation,
): Promise<RenderedEmail> {
  return renderMemberInvite(
    {
      inviterName: sender.inviterName.trim() === '' ? NO_INVITER : sender.inviterName,
      role: each.invitation.role,
      acceptPath: `/invite/${each.token}`,
      expiresAt: each.invitation.expiresAt,
    },
    { appOrigin: new URL(context.appUrl).origin, workspaceName: sender.workspaceName },
  );
}

/**
 * The key a resent email is told apart by (AC-808): the invitation's id and
 * its send count, so a retried send of one email goes out once and a resend
 * (one more send) goes out again.
 */
export function inviteMailKey(invitationId: string, sendCount: number): string {
  return `invite:${invitationId}:${String(sendCount)}`;
}

/**
 * Mails each invitation its link from this request, once the write
 * committed, never queued (the raw token lives only in the email). A failure
 * is logged and reported, never thrown: the invitation stands, the answer
 * names the address as unsent, and Resend tries again. The token travels
 * only in the email, never in a log line.
 */
async function mailAll(
  context: Pick<RequestContext, 'mailer' | 'appUrl' | 'requestId'>,
  sender: InviteSender,
  sent: readonly SentInvitation[],
): Promise<string[]> {
  const unsent: string[] = [];
  for (const each of sent) {
    try {
      const message = await inviteEmail(context, sender, each);
      // TODO(AC-808): pass `idempotencyKey: inviteMailKey(each.invitation.id, each.sendCount)` once MailMessage
      // takes one (emails part 2), so a retried send goes out once.
      await context.mailer.send({ to: each.invitation.email, ...message });
    } catch (error) {
      unsent.push(each.invitation.email);
      log.error('Invitation email not sent', {
        requestId: context.requestId,
        invitationId: each.invitation.id,
        sendCount: each.sendCount,
        mail: context.mailer.transport,
        ...errorFields(error),
      });
      captureFault(error, { requestId: context.requestId, task: 'invitation mail' });
    }
  }
  return unsent;
}

export const invitationsRouter = {
  create: member.invitations.create.handler(async ({ context, input }) => {
    const { scope } = context;
    const outcome = await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      inviteMembers(scope, { emails: input.emails, role: input.role }, hooks, {
        source: sourceOf(context),
        limit: (sends) => limitSends(context, scope.workspaceId, context.user.id, sends),
      }),
    );
    const unsent = await mailAll(context, outcome, outcome.sent);
    return { invited: outcome.sent.map((each) => each.invitation), refused: [...outcome.refused], unsent };
  }),
  list: member.invitations.list.handler(({ context }) => listInvitations(context.scope)),
  resend: member.invitations.resend.handler(async ({ context, input }) => {
    const { scope } = context;
    const resent = await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      resendInvite(scope, { invitationId: input.invitationId }, hooks, {
        source: sourceOf(context),
        limit: (sends) => limitSends(context, scope.workspaceId, context.user.id, sends),
      }),
    );
    const unsent = await mailAll(context, resent, [resent]);
    return { invitation: resent.invitation, sent: unsent.length === 0 };
  }),
  revoke: member.invitations.revoke.handler(async ({ context, input }) => {
    await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      revokeInvite(context.scope, { invitationId: input.invitationId }, hooks, { source: sourceOf(context) }),
    );
  }),
  // The invite link (slice 6, AC-818): the card reads it, and turns it on, off, changes or resets it.
  link: member.invitations.link.handler(({ context }) => getInviteLink(context.scope)),
  setLink: member.invitations.setLink.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      setInviteLink(
        context.scope,
        {
          enabled: input.enabled,
          ...(input.role === undefined ? {} : { role: input.role }),
          ...(input.expiresInDays === undefined ? {} : { expiresInDays: input.expiresInDays }),
          ...(input.maxUses === undefined ? {} : { maxUses: input.maxUses }),
          ...(input.reset === undefined ? {} : { reset: input.reset }),
        },
        hooks,
        { source: sourceOf(context) },
      ),
    ),
  ),
  ...invitationsPublic,
};
