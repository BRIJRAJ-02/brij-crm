import { menuWorkspaceTags } from '@crm/contracts';
import {
  operatorOverview,
  operatorPage,
  operatorPages,
  operatorSite,
  operatorUser,
  operatorUsers,
  setEarlyAccess,
  type OperatorDeps,
} from '@crm/core';
import { errorFields, log } from '../../log.ts';
import { captureFault } from '../../monitoring/sentry.ts';
import { operator, type RequestContext } from '../../orpc.ts';

// The operator console (spec 0047): read only, behind the operator gate (`requireOperator`: OPERATOR_EMAILS, two
// factor, a recent sign in, and one log row per read). Its services read across workspaces only through
// crm_operator's definers (counts and names) and the identity login's global rows.
const deps = (context: RequestContext): OperatorDeps => ({ db: context.db, identity: context.identity });

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
    // Closing a workspace's business apps takes its guest menus off the edge at once (spec 0065, H1).
    if (!input.on) await context.edgeCache.forget(menuWorkspaceTags(input.workspaceId));
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
});
