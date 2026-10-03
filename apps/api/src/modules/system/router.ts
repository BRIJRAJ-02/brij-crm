import { getSystemStatus } from '@crm/core';
import { pub } from '../../orpc.ts';

export const systemRouter = pub.system.router({
  status: pub.system.status.handler(({ context }) =>
    getSystemStatus({ db: context.db, environment: context.environment, providers: context.auth.providers }),
  ),
});
