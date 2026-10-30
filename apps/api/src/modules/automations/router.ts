import {
  createAutomation,
  deleteAutomation,
  listAutomationRuns,
  listAutomations,
  restoreAutomation,
  setAutomationEnabled,
  updateAutomation,
} from '@crm/core';
import { withInputFields } from '../../errors.ts';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// Automations (parity #53), inside a workspace: every call needs `automations.manage` (the services check it first). A
// write goes through `commitWrite`, so its `automations` event is stored with it. The runs themselves happen in the
// worker's `crm_automation` task, as the member each automation runs as; nothing here runs an action.
export const automationsRouter = member.automations.router({
  list: member.automations.list.handler(({ context }) => listAutomations(context.scope)),
  create: member.automations.create.handler(async ({ context, input }) => {
    try {
      return await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
        createAutomation(context.scope, { id: input.id, definition: input.definition }, hooks),
      );
    } catch (error) {
      throw withInputFields(error, { ID_TAKEN: 'id' });
    }
  }),
  update: member.automations.update.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      updateAutomation(context.scope, { automationId: input.automationId, definition: input.definition }, hooks),
    ),
  ),
  setEnabled: member.automations.setEnabled.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      setAutomationEnabled(context.scope, { automationId: input.automationId, enabled: input.enabled }, hooks),
    ),
  ),
  remove: member.automations.remove.handler(async ({ context, input }) => {
    await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      deleteAutomation(context.scope, { automationId: input.automationId }, hooks),
    );
    return { ok: true as const };
  }),
  restore: member.automations.restore.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      restoreAutomation(context.scope, { automationId: input.automationId }, hooks),
    ),
  ),
  runs: member.automations.runs.handler(({ context, input }) =>
    listAutomationRuns(context.scope, {
      ...(input.automationId === undefined ? {} : { automationId: input.automationId }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    }),
  ),
});
