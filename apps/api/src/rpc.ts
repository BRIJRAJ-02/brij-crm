// The RPC handler for /api/rpc, with the error plumbing around every call.
//
// Two interceptors, because oRPC reads the request body outside the procedure:
// - around each procedure call, every error becomes the API's shape (see
//   errors.ts), an unexpected one is logged with the request id, and a code
//   that asks for a retry sets `Retry-After`;
// - around the whole request, what's left: oRPC's own errors from before the
//   procedure (a GET on a POST procedure, say) get a code from the map, and
//   anything that isn't an oRPC error never reached a procedure, so it came
//   from reading the body: that's INPUT_INVALID.
import { ErrorCode, retryAfterSeconds } from '@crm/contracts';
import type { AnyRouter } from '@orpc/server';
import { ORPCError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { ResponseHeadersPlugin } from '@orpc/server/plugins';
import { apiError, toApiError } from './errors.ts';
import { errorFields, log } from './log.ts';
import type { RequestContext } from './orpc.ts';

// The error's name and where it was thrown, without its message: a parse
// error's message can quote the request body.
function withoutMessage(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { error: { name: typeof error } };
  const frames = error.stack?.split('\n').filter((line) => line.trimStart().startsWith('at '));
  return { error: { name: error.name, stack: frames?.join('\n') } };
}

/** The handler `app.ts` mounts on `/api/rpc`, for the app's router (or a test's). */
export function createRpcHandler(router: AnyRouter): RPCHandler<RequestContext> {
  return new RPCHandler<RequestContext>(router, {
    plugins: [new ResponseHeadersPlugin()],
    clientInterceptors: [
      async (options) => {
        const { context, path } = options;
        try {
          return await options.next();
        } catch (thrown) {
          const { error, expected } = toApiError(thrown);
          if (!expected) {
            log.error('Unhandled error', {
              requestId: context.requestId,
              procedure: path.join('.'),
              ...errorFields(thrown),
            });
          }
          const retryAfter = retryAfterSeconds(error.code);
          if (retryAfter !== undefined) context.resHeaders?.set('retry-after', String(retryAfter));
          throw error;
        }
      },
    ],
    interceptors: [
      async (options) => {
        const { context } = options;
        try {
          return await options.next();
        } catch (thrown) {
          // Already through the procedure interceptor above: logged there if it had to be.
          if (thrown instanceof ORPCError && ErrorCode.safeParse(thrown.code).success) throw thrown;
          if (thrown instanceof ORPCError) {
            const { error, expected } = toApiError(thrown);
            if (!expected) log.error('Unhandled error', { requestId: context.requestId, ...errorFields(thrown) });
            throw error;
          }
          log.warn('Unreadable RPC request', { requestId: context.requestId, ...withoutMessage(thrown) });
          throw apiError('INPUT_INVALID', 'The request body could not be read.');
        }
      },
    ],
  });
}
