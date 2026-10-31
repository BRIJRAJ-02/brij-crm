import { createApiKey, listApiKeys, restoreApiKey, revokeApiKey } from '@crm/core';
import { withInputFields } from '../../errors.ts';
import { member, type RequestContext } from '../../orpc.ts';

// API keys (parity #34), inside a workspace: every call needs `api_keys.manage` (the services check it first). A key
// is a definition of who may call `/api/v1`, not CRM data, so these writes store no outbox row (no screen watches
// them live); each writes its audit row in its own transaction. A key's own requests are `src/v1/`.

/** Where a key change came from, for its audit row: the request's id and the address the edge vouched for. */
const sourceOf = (context: Pick<RequestContext, 'requestId' | 'clientIp'>) => ({
  requestId: context.requestId,
  ...(context.clientIp === undefined ? {} : { ip: context.clientIp }),
});

export const apiKeysRouter = member.apiKeys.router({
  list: member.apiKeys.list.handler(({ context }) => listApiKeys(context.scope)),
  create: member.apiKeys.create.handler(async ({ context, input }) => {
    try {
      return await createApiKey(
        context.scope,
        { id: input.id, name: input.name, access: input.access },
        sourceOf(context),
      );
    } catch (error) {
      throw withInputFields(error, { ID_TAKEN: 'id' });
    }
  }),
  revoke: member.apiKeys.revoke.handler(({ context, input }) =>
    revokeApiKey(context.scope, { keyId: input.keyId }, sourceOf(context)),
  ),
  restore: member.apiKeys.restore.handler(({ context, input }) =>
    restoreApiKey(context.scope, { keyId: input.keyId }, sourceOf(context)),
  ),
});
