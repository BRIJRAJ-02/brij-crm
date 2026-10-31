import { previewComputed, refillComputed } from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// Computed attributes (spec 0015): the dialog's preview, which writes nothing, and the refill after a failed fill.
// Both need `schema.manage`, checked by core before anything is read.
export const computedRouter = member.computed.router({
  preview: member.computed.preview.handler(({ context, input }) =>
    previewComputed(context.scope, { objectId: input.objectId, definition: input.definition }),
  ),
  refill: member.computed.refill.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      refillComputed(context.scope, input.attributeId, hooks),
    ),
  ),
});
