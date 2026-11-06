import {
  operatorOverview,
  operatorPage,
  operatorPages,
  operatorSite,
  operatorUser,
  operatorUsers,
  type OperatorDeps,
} from '@crm/core';
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
});
