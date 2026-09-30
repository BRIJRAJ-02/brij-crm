import { getSystemStatus } from '@crm/core';
import { base } from '../../orpc.ts';

export const systemRouter = base.system.router({
  status: base.system.status.handler(({ context }) =>
    getSystemStatus({ db: context.db, environment: context.environment }),
  ),
});
