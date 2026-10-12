import { archiveOption, createOption, editOption, moveOption, restoreOption } from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// Inside a workspace: the door has let in an active member, and `context.scope` is theirs. Every write needs
// `schema.manage`, checked by the engine (spec 0012); a taken label refuses on `label` itself.
export const optionsRouter = member.options.router({
  create: member.options.create.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      createOption(
        context.scope,
        {
          attributeId: input.attributeId,
          id: input.id,
          label: input.label,
          hue: input.hue,
          outcome: input.outcome,
          targetTimeInStage: input.targetTimeInStage,
        },
        hooks,
      ),
    ),
  ),
  update: member.options.update.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      editOption(
        context.scope,
        {
          optionId: input.optionId,
          label: input.label,
          hue: input.hue,
          outcome: input.outcome,
          targetTimeInStage: input.targetTimeInStage,
        },
        hooks,
      ),
    ),
  ),
  reorder: member.options.reorder.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      moveOption(context.scope, { optionId: input.optionId, position: input.position }, hooks),
    ),
  ),
  archive: member.options.archive.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      archiveOption(context.scope, { optionId: input.optionId }, hooks),
    ),
  ),
  restore: member.options.restore.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      restoreOption(context.scope, { optionId: input.optionId }, hooks),
    ),
  ),
});
