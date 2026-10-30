import { getObjectAccess, previewAccess, setObjectAccess } from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';
import { sourceOf } from '../../source.ts';

// Inside a workspace: the door has let in an active member, and `context.scope` is theirs. Both need `access.manage`
// (checked in packages/core, spec 0032, AC-851); a rule change stores its audit row and the `access` row naming the
// members it covers with the write. A preview reads as the chosen person through the same policy, writes one audit
// row and nothing else.
export const accessRulesRouter = member.accessRules.router({
  get: member.accessRules.get.handler(({ context, input }) =>
    getObjectAccess(context.scope, { objectId: input.objectId }),
  ),
  set: member.accessRules.set.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      setObjectAccess(context.scope, { objectId: input.objectId, subject: input.subject, rule: input.rule }, hooks, {
        source: sourceOf(context),
      }),
    ),
  ),
  preview: member.accessRules.preview.handler(({ context, input }) =>
    previewAccess(context.scope, { objectId: input.objectId, as: input.as }, { source: sourceOf(context) }),
  ),
});
