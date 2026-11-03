import {
  createInsightShare,
  listInsightShares,
  readInsights,
  readInsightSessions,
  revokeInsightShare,
} from '@crm/core';
import { member, type RequestContext } from '../../orpc.ts';

// Insights (spec 0067), inside a workspace: the door has let in an active member, and `context.scope` is theirs.
// Which pages they may see, and whose names a session shows, is each product's own rule in the core. A share link is
// a definition of numbers someone may read, not CRM data, so its writes store no outbox row (no screen follows them
// live); each writes its audit row in its own transaction.

/** Where a share change came from, for its audit row: the request's id and the address the edge vouched for. */
const sourceOf = (context: Pick<RequestContext, 'requestId' | 'clientIp'>) => ({
  requestId: context.requestId,
  ...(context.clientIp === undefined ? {} : { ip: context.clientIp }),
});

export const insightsRouter = member.insights.router({
  read: member.insights.read.handler(async ({ context, input }) => {
    const read = await readInsights(context.scope, { period: input.period, pages: input.pages });
    return {
      ...read,
      ...(read.funnel === undefined ? {} : { funnel: { ...read.funnel, steps: [...read.funnel.steps] } }),
    };
  }),
  sessions: member.insights.sessions.handler(async ({ context, input }) => {
    const page = await readInsightSessions(context.scope, {
      period: input.period,
      pages: input.pages,
      filter: input.filter,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    });
    return { ...page, items: [...page.items] };
  }),
  shares: {
    list: member.insights.shares.list.handler(async ({ context }) => {
      const listed = await listInsightShares(context.scope);
      return { shares: [...listed.shares] };
    }),
    create: member.insights.shares.create.handler(({ context, input }) =>
      createInsightShare(
        context.scope,
        {
          label: input.label,
          pages: input.pages,
          range: input.range,
          ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
        },
        sourceOf(context),
      ),
    ),
    revoke: member.insights.shares.revoke.handler(({ context, input }) =>
      revokeInsightShare(context.scope, { shareId: input.shareId }, sourceOf(context)),
    ),
  },
});
