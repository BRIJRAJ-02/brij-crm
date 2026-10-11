import { getUsage } from '@crm/core';
import { member } from '../../orpc.ts';

// Inside a workspace: the door has let in an active member. The counts are filtered by their access in the
// service (spec 0012, AC-243): the custom object total only with `schema.manage`.
export const usageRouter = member.usage.router({
  get: member.usage.get.handler(({ context }) => getUsage(context.scope)),
});
