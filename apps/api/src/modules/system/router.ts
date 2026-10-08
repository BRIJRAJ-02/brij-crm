import { getSystemStatus } from '@crm/core';
import { os } from '@orpc/server';
import { apiError } from '../../errors.ts';
import { pub, type RequestContext, requireSession } from '../../orpc.ts';

/** What `system.testFault` throws when it is on: an unexpected error, on purpose. */
export const TEST_FAULT_MESSAGE = 'The monitoring test fault failed on purpose (MONITORING_TEST_FAULT=on).';

/**
 * Off, the test fault is a procedure that doesn't exist, before anything
 * else, so nobody learns it is there (the app answers its address the same
 * way; this is the second lock).
 */
const switchedOn = os.$context<RequestContext>().middleware(({ context, next }) => {
  if (!context.testFault) throw apiError('NOT_FOUND', 'There is nothing at this address.');
  return next();
});

export const systemRouter = pub.system.router({
  status: pub.system.status.handler(({ context }) =>
    getSystemStatus({ db: context.db, environment: context.environment, providers: context.auth.providers }),
  ),
  // Spec 0010, AC-168: proves a production error reaches Sentry with its request id, then is switched off.
  testFault: pub.system.testFault
    .use(switchedOn)
    .use(requireSession)
    .handler(() => {
      throw new Error(TEST_FAULT_MESSAGE);
    }),
});
