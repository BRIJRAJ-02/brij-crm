import { linkPageCacheTags } from '@crm/contracts';
import {
  addPageOnlyPerson,
  cancelLoginInvite,
  cancelPageInvite,
  enterTeamLinkPage,
  getMyProfile,
  inviteToClaimLogin,
  inviteToManagePage,
  checkTeamHandle,
  claimTeamHandle,
  listTeamLinkPages,
  namePageOnlyPerson,
  readLinkPageEditedBy,
  readMyLogin,
  removePageOnlyPerson,
  setManagedSocials,
  suggestTeamHandle,
  type PageInviteToSend,
} from '@crm/core';
import { renderMemberInvite } from '@crm/emails';
import { apiError } from '../../errors.ts';
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

/**
 * How many Wallet passes Team pages makes: each one is signed, which holds the process for a moment, so the window
 * is short. 40 in ten seconds a person (the screen asks one at a time, so a team's zip stays under it), and 80 a
 * workspace, so several managers at once can't queue more.
 */
const WALLET_PASSES = { window: 10, max: 40 } as const;
const WALLET_PASSES_WORKSPACE = { window: 10, max: 80 } as const;

// Team link pages (spec 0070, slice 1): everyone's link page in the workspace for a holder of
// `link_pages.manage_team` (checked in packages/core before anything is read), a handle claimed for someone, and who
// last changed the caller's own page. Editing a member's page goes through the `profile.*` procedures with `member`.
// Page only people (9 Nov 2026): added with a page and removed again from Team pages, their identity made by the
// identity login (`context.pageOnlyUsers`), never the app's.
export const teamPagesRouter = member.teamPages.router({
  // Inside a connected app's frame, a login invitation's address is left out (spec 0070, AC-7023).
  list: member.teamPages.list.handler(async ({ context }) => {
    const listed = await listTeamLinkPages(context.scope, new Date(), { fromFrame: context.embed !== undefined });
    return context.pagePass === undefined ? listed : { ...listed, hasWallet: true };
  }),
  // One person's Apple Wallet pass (13 Nov 2026). The team door first (`link_pages.manage_team`, then an active
  // member of this workspace; the caller's own row is their own page), then the pass their Live page offers anyone.
  walletPass: member.teamPages.walletPass.handler(async ({ context, input }) => {
    const none = () => apiError('NOT_FOUND', 'There’s no Wallet pass for this page. Make the page Live first.');
    const make = context.pagePass;
    if (make === undefined) throw none();
    const { principal } = context.scope.access;
    const isOwn = principal.kind === 'member' && principal.memberId === input.member;
    const page = isOwn ? context.scope : await enterTeamLinkPage(context.scope, input.member);
    const { handle } = await getMyProfile(page);
    if (handle === undefined) throw none();
    const mine = await context.limiter.consumeRateLimit(`team-wallet-pass:${context.user.id}`, WALLET_PASSES);
    const ours = await context.limiter.consumeRateLimit(
      `team-wallet-pass:ws:${context.scope.workspaceId}`,
      WALLET_PASSES_WORKSPACE,
    );
    if (!mine.allowed || !ours.allowed) {
      throw apiError('RATE_LIMITED', 'Too many passes at once. Wait a moment and try again.');
    }
    // Held to this workspace: the handle was read here, and the pass is only ever this workspace's page's.
    const made = await make(handle, context.scope.workspaceId);
    if (made === undefined) throw none();
    return { name: `${made.handle}.pkpass`, data: Buffer.from(made.bytes).toString('base64') };
  }),
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
  // A page only person's name and the title under it (9 Nov 2026), from their page's editor; or, from Timefix itself, a
  // disconnected app's person's (10 Nov 2026, core checks the connection). Their page draws both,
  // so the edge's copies of it are deleted once the change has committed.
  namePerson: member.teamPages.namePerson.handler(async ({ context, input }) => {
    const { handle, ...named } = await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      namePageOnlyPerson(
        context.scope,
        { member: input.member, name: input.name, jobTitle: input.jobTitle },
        hooks,
        sourceOf(context),
        { fromConnection: context.embed?.connectionId },
      ),
    );
    if (handle !== undefined) await context.edgeCache.forget(linkPageCacheTags(handle));
    return named;
  }),
  // The social links of someone with no login of their own (10 Nov 2026), from their page's editor. Inside a connected
  // app's frame only that app's people and the workspace's page only people; in Timefix itself only page only people,
  // since an app's people are that app's to keep (core checks both, and names the app in its refusal). Their page
  // draws the links, so the edge's copies of it are deleted once the change has committed.
  setSocials: member.teamPages.setSocials.handler(async ({ context, input }) => {
    const { handle, ...saved } = await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      setManagedSocials(context.scope, { member: input.member, socials: input.socials }, hooks, sourceOf(context), {
        fromConnection: context.embed?.connectionId,
        partnerName: async (partnerId) => (await context.partners.partnerById(partnerId))?.name,
      }),
    );
    if (handle !== undefined) await context.edgeCache.forget(linkPageCacheTags(handle));
    return saved;
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
