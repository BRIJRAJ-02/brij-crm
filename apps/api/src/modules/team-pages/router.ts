import { linkPageCacheTags } from '@crm/contracts';
import {
  addPageOnlyPerson,
  cancelLoginInvite,
  cancelPageInvite,
  inviteToClaimLogin,
  inviteToManagePage,
  checkTeamHandle,
  claimTeamHandle,
  listTeamLinkPages,
  namePageOnlyPerson,
  readLinkPageEditedBy,
  readMyLogin,
  removePageOnlyPerson,
  suggestTeamHandle,
  type PageInviteToSend,
} from '@crm/core';
import { renderMemberInvite } from '@crm/emails';
import { commitWrite } from '../../hooks.ts';
import { errorFields, log } from '../../log.ts';
import { captureFault } from '../../monitoring/sentry.ts';
import { member, type RequestContext } from '../../orpc.ts';
import { sourceOf } from '../../source.ts';
import { limitSends, NO_INVITER } from '../invitations/router.ts';

/**
 * Mails a page's hand over its link from this request, once the write committed, never queued (the raw token lives
 * only in the email), with the invitation's template in its page form. A failure is logged and reported, never thrown:
 * the invitation stands and the answer says it wasn't sent, so Team pages offers to send it again.
 */
async function mailHandover(
  context: Pick<RequestContext, 'mailer' | 'appUrl' | 'requestId'>,
  sent: PageInviteToSend,
  /** A connected app's person's own login (spec 0070, AC-7023): the app that keeps them, by name when known. */
  login?: { readonly app?: string },
): Promise<boolean> {
  try {
    const message = await renderMemberInvite(
      {
        inviterName: sent.inviterName.trim() === '' ? NO_INVITER : sent.inviterName,
        role: 'member',
        acceptPath: `/invite/${sent.token}`,
        expiresAt: sent.invite.expiresAt,
        page: sent.page.handle === undefined ? {} : { handle: sent.page.handle },
        ...(login === undefined ? {} : { login }),
      },
      { appOrigin: new URL(context.appUrl).origin, workspaceName: sent.workspaceName },
    );
    await context.mailer.send({ to: sent.invite.email, ...message });
    return true;
  } catch (error) {
    log.error('Page hand over email not sent', {
      requestId: context.requestId,
      invitationId: sent.invitationId,
      sendCount: sent.sendCount,
      mail: context.mailer.transport,
      ...errorFields(error),
    });
    captureFault(error, { requestId: context.requestId, task: 'page hand over mail' });
    return false;
  }
}

// Team link pages (spec 0070, slice 1): everyone's link page in the workspace for a holder of
// `link_pages.manage_team` (checked in packages/core before anything is read), a handle claimed for someone, and who
// last changed the caller's own page. Editing a member's page goes through the `profile.*` procedures with `member`.
// Page only people (9 Nov 2026): added with a page and removed again from Team pages, their identity made by the
// identity login (`context.pageOnlyUsers`), never the app's.
export const teamPagesRouter = member.teamPages.router({
  list: member.teamPages.list.handler(({ context }) => listTeamLinkPages(context.scope)),
  claim: member.teamPages.claim.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      claimTeamHandle(context.scope, { member: input.member, handle: input.handle }, sourceOf(context)),
    ),
  ),
  addPerson: member.teamPages.addPerson.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      addPageOnlyPerson(
        context.scope,
        { name: input.name, email: input.email, handle: input.handle },
        { users: context.pageOnlyUsers },
        hooks,
        sourceOf(context),
      ),
    ),
  ),
  removePerson: member.teamPages.removePerson.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      removePageOnlyPerson(
        context.scope,
        { member: input.member },
        { users: context.pageOnlyUsers },
        hooks,
        sourceOf(context),
      ),
    ),
  ),
  // A page only person's name and the title under it (9 Nov 2026), from their page's editor. Their page draws both,
  // so the edge's copies of it are deleted once the change has committed.
  namePerson: member.teamPages.namePerson.handler(async ({ context, input }) => {
    const { handle, ...named } = await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      namePageOnlyPerson(
        context.scope,
        { member: input.member, name: input.name, jobTitle: input.jobTitle },
        hooks,
        sourceOf(context),
      ),
    );
    if (handle !== undefined) await context.edgeCache.forget(linkPageCacheTags(handle));
    return named;
  }),
  // Invite to manage their page (9 Nov 2026): the hand over's invitation, counted against the same send limits as any
  // invitation (AC-808), and mailed once it committed.
  invitePerson: member.teamPages.invitePerson.handler(async ({ context, input }) => {
    const { scope } = context;
    const sent = await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      inviteToManagePage(scope, { member: input.member, email: input.email }, hooks, {
        source: sourceOf(context),
        limit: (sends) => limitSends(context, scope.workspaceId, context.user.id, sends),
      }),
    );
    return { invite: sent.invite, sent: await mailHandover(context, sent) };
  }),
  cancelInvite: member.teamPages.cancelInvite.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      cancelPageInvite(context.scope, { member: input.member }, hooks, sourceOf(context)),
    ),
  ),
  // A connected app's person's own Timefix login (spec 0070, AC-7023): set up from Timefix by a manager holding both
  // permissions, never from the app's frame; counted against the same send limits as any invitation, and mailed once
  // it committed, naming the app that keeps them (a failed read of its name leaves it out, never the email).
  inviteLogin: member.teamPages.inviteLogin.handler(async ({ context, input }) => {
    const { scope } = context;
    const sent = await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      inviteToClaimLogin(scope, { member: input.member, email: input.email }, hooks, {
        source: sourceOf(context),
        limit: (sends) => limitSends(context, scope.workspaceId, context.user.id, sends),
        // Never from inside a connected app's frame (the frame doesn't reach this procedure; core refuses it too).
        fromFrame: context.embed !== undefined,
      }),
    );
    const app = await context.partners.partnerById(sent.partnerId).then(
      (partner) => partner?.name,
      () => undefined,
    );
    return { invite: sent.invite, sent: await mailHandover(context, sent, app === undefined ? {} : { app }) };
  }),
  cancelLoginInvite: member.teamPages.cancelLoginInvite.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      cancelLoginInvite(context.scope, { member: input.member }, hooks, {
        source: sourceOf(context),
        fromFrame: context.embed !== undefined,
      }),
    ),
  ),
  myLogin: member.teamPages.myLogin.handler(({ context }) => readMyLogin(context.scope)),
  checkHandle: member.teamPages.checkHandle.handler(({ context, input }) =>
    checkTeamHandle(context.scope, { handle: input.handle }),
  ),
  suggestHandle: member.teamPages.suggestHandle.handler(({ context, input }) =>
    suggestTeamHandle(context.scope, { name: input.name }),
  ),
  editedBy: member.teamPages.editedBy.handler(({ context }) => readLinkPageEditedBy(context.scope)),
});
