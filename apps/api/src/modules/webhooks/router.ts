import {
  checkWebhooksAccess,
  createWebhook,
  deleteWebhook,
  listWebhookDeliveries,
  listWebhooks,
  prepareWebhookResend,
  prepareWebhookTest,
  recordWebhookSend,
  rotateWebhookSecret,
  updateWebhook,
} from '@crm/core';
import { WEBHOOK_SENDS_PER_MINUTE } from '@crm/contracts';
import { apiError } from '../../errors.ts';
import { commitWrite } from '../../hooks.ts';
import { member, type RequestContext, type WebhookServices } from '../../orpc.ts';

// Settings › Webhooks (spec 0064, AC-6419 to AC-6425). Inside a workspace, behind the member door; core checks
// `webhooks.manage` (owners and admins) before it reads or writes anything. Where `WEBHOOK_SECRET_KEY` is unset, the
// list answers `available: false` and every write 503 API_UNAVAILABLE. Send test event and Resend send from the
// request through the one webhook sender (`jobs/webhook-deliver.ts`), at most 10 a minute per endpoint, and answer
// the delivery as recorded. No write stores an outbox row: nobody else's screen follows an endpoint live.

/** What every write answers where the sealing key is unset. */
const UNAVAILABLE = 'Webhooks aren’t set up on this server yet.';

/** The webhook services, or 503 where they are off. */
function servicesOf(context: Pick<RequestContext, 'webhooks'>): WebhookServices {
  if (context.webhooks === undefined) throw apiError('API_UNAVAILABLE', UNAVAILABLE);
  return context.webhooks;
}

/** Counts one test or resend against the endpoint's minute (the API table): 429 RATE_LIMITED past 10. */
async function limitSends(context: Pick<RequestContext, 'limiter'>, workspaceId: string, endpointId: string) {
  const decision = await context.limiter.consumeRateLimit(`webhook-send:${workspaceId}:${endpointId}`, {
    window: 60,
    max: WEBHOOK_SENDS_PER_MINUTE,
  });
  if (!decision.allowed)
    throw apiError('RATE_LIMITED', 'That’s a lot of sends to this endpoint. Wait a minute, then try again.');
}

export const webhooksRouter = member.webhooks.router({
  list: member.webhooks.list.handler(async ({ context }) => {
    const listed = await listWebhooks(context.scope, context.webhooks !== undefined);
    return {
      available: listed.available,
      endpoints: listed.endpoints.map((each) => ({ ...each, events: [...each.events] })),
    };
  }),
  create: member.webhooks.create.handler(async ({ context, input }) => {
    const services = servicesOf(context);
    const made = await commitWrite(context, { mutationId: input.mutationId }, () =>
      createWebhook(context.scope, services, { url: input.url, description: input.description, events: input.events }),
    );
    return { ...made, endpoint: { ...made.endpoint, events: [...made.endpoint.events] } };
  }),
  update: member.webhooks.update.handler(async ({ context, input }) => {
    const services = servicesOf(context);
    const updated = await commitWrite(context, { mutationId: input.mutationId }, () =>
      updateWebhook(context.scope, services, {
        endpointId: input.endpointId,
        url: input.url,
        description: input.description,
        events: input.events,
        status: input.status,
      }),
    );
    return { ...updated, events: [...updated.events] };
  }),
  rotateSecret: member.webhooks.rotateSecret.handler(async ({ context, input }) => {
    const services = servicesOf(context);
    const rotated = await commitWrite(context, { mutationId: input.mutationId }, () =>
      rotateWebhookSecret(context.scope, services, { endpointId: input.endpointId }),
    );
    return { ...rotated, endpoint: { ...rotated.endpoint, events: [...rotated.endpoint.events] } };
  }),
  delete: member.webhooks.delete.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      deleteWebhook(context.scope, { endpointId: input.endpointId }),
    ),
  ),
  test: member.webhooks.test.handler(async ({ context, input }) => {
    const services = servicesOf(context);
    // The power first, so nobody without it can spend an admin's sends.
    await checkWebhooksAccess(context.scope);
    await limitSends(context, context.scope.workspaceId, input.endpointId);
    return commitWrite(context, { mutationId: input.mutationId }, async () => {
      const send = await prepareWebhookTest(context.scope, services.key, { endpointId: input.endpointId });
      return recordWebhookSend(context.scope, send, await services.send(send));
    });
  }),
  deliveries: member.webhooks.deliveries.handler(async ({ context, input }) => {
    const page = await listWebhookDeliveries(context.scope, {
      endpointId: input.endpointId,
      cursor: input.cursor,
      limit: input.limit,
    });
    return { ...page, deliveries: [...page.deliveries] };
  }),
  resend: member.webhooks.resend.handler(async ({ context, input }) => {
    const services = servicesOf(context);
    return commitWrite(context, { mutationId: input.mutationId }, async () => {
      const send = await prepareWebhookResend(context.scope, services.key, { deliveryId: input.deliveryId });
      await limitSends(context, context.scope.workspaceId, send.endpointId);
      return recordWebhookSend(context.scope, send, await services.send(send));
    });
  }),
});
