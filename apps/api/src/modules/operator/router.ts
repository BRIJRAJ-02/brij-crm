import {
  businessCacheTags,
  menuWorkspaceCacheTags,
  operatorOverview,
  operatorPage,
  operatorPages,
  operatorSite,
  operatorUser,
  operatorUsers,
  listPartners,
  registerPartner,
  replacePartnerSecret,
  setEarlyAccess,
  updatePartner,
  wipeTestConnections,
  type OperatorDeps,
} from '@crm/core';
import { apiError } from '../../errors.ts';
import { forgetAfterCommit } from '../../edge-cache.ts';
import { errorFields, log } from '../../log.ts';
import { captureFault } from '../../monitoring/sentry.ts';
import { operator, type RequestContext } from '../../orpc.ts';

// The operator console (spec 0047): read only, behind the operator gate (`requireOperator`: OPERATOR_EMAILS, two
// factor, a recent sign in, and one log row per read). Its services read across workspaces only through
// crm_operator's definers (counts and names) and the identity login's global rows.
const deps = (context: RequestContext): OperatorDeps => ({ db: context.db, identity: context.identity });

/** A partner change's row in the console's log (spec 0070, AC-7010), written in the change's own transaction. */
const auditOf = (context: RequestContext & { readonly user: { readonly id: string } }, action: string) => ({
  userId: context.user.id,
  action,
  requestId: context.requestId,
});

export const operatorRouter = operator.operator.router({
  overview: operator.operator.overview.handler(({ context, input }) => operatorOverview(deps(context), input.period)),
  users: operator.operator.users.handler(({ context, input }) =>
    operatorUsers(deps(context), {
      period: input.period,
      ...(input.q === undefined ? {} : { q: input.q }),
      ...(input.after === undefined ? {} : { after: input.after }),
    }),
  ),
  user: operator.operator.user.handler(({ context, input }) => operatorUser(deps(context), input)),
  pages: operator.operator.pages.handler(({ context, input }) => operatorPages(deps(context), input.period)),
  page: operator.operator.page.handler(({ context, input }) => operatorPage(deps(context), input)),
  site: operator.operator.site.handler(({ context, input }) => operatorSite(deps(context), input.period)),
  // The console's one write (spec 0065, AC-6502): the gate logged the attempt before it ran; once the switch is
  // made, its before and after join the log as a row of their own.
  setEarlyAccess: operator.operator.setEarlyAccess.handler(async ({ context, input }) => {
    const change = await setEarlyAccess({ db: context.db }, input);
    // Closing a workspace's business apps takes its guest menus (spec 0065, H1) and its business page, with the
    // page's photos (spec 0066), off the edge at once. The switch has committed, so a failed purge never refuses it.
    if (!input.on) {
      await forgetAfterCommit(context.edgeCache, menuWorkspaceCacheTags(input.workspaceId));
      await forgetAfterCommit(context.edgeCache, businessCacheTags(input.workspaceId));
    }
    const event = {
      userId: context.user.id,
      action: 'operator.earlyAccessChanged',
      target: input.workspaceId,
      requestId: context.requestId,
      before: { earlyAccess: change.before },
      after: { earlyAccess: change.after },
    };
    // The switch has committed: a failed log row is tried once more, then reported, never left silent.
    try {
      await context.identity.logOperatorEvent(event).catch(() => context.identity.logOperatorEvent(event));
    } catch (error) {
      log.error('Early access change not logged', { requestId: context.requestId, ...errorFields(error) });
      captureFault(error, { task: 'operator-early-access-log' });
    }
    return change;
  }),
  // Partners (spec 0070, AC-7010): the registry on the identity login. A secret is answered once and never logged.
  partners: operator.operator.partners.handler(({ context }) => listPartners({ partners: context.identity })),
  registerPartner: operator.operator.registerPartner.handler(({ context, input }) =>
    registerPartner({ partners: context.identity }, input, auditOf(context, 'operator.partnerRegistered')),
  ),
  updatePartner: operator.operator.updatePartner.handler(({ context, input }) =>
    updatePartner({ partners: context.identity }, input, auditOf(context, 'operator.partnerChanged')),
  ),
  replacePartnerSecret: operator.operator.replacePartnerSecret.handler(({ context, input }) =>
    replacePartnerSecret({ partners: context.identity }, input, auditOf(context, 'operator.partnerSecretReplaced')),
  ),
  // The sandbox (spec 0070, AC-7035): a test partner's live test connections ended in one go, each in its own
  // workspace with its History row, then their embedded sessions. The gate's row names the partner (`partnerId`).
  wipeTestConnections: operator.operator.wipeTestConnections.handler(async ({ context, input }) => {
    const partner = await context.identity.partnerById(input.partnerId);
    if (partner === undefined) throw apiError('NOT_FOUND', 'There is no partner with that id.');
    if (!partner.isTest) {
      throw apiError('CONFIG_INVALID', 'Only a sandbox partner’s connections can be wiped. Mark it as a test first.');
    }
    const ended = await wipeTestConnections({ db: context.db }, { id: partner.id, name: partner.name });
    await context.identity.endEmbedSessions(ended);
    log.info('operator.partnerTestsWiped', {
      requestId: context.requestId,
      partnerId: partner.id,
      wiped: ended.length,
    });
    return { wiped: ended.length };
  }),
});
