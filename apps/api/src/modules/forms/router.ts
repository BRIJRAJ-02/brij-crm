import {
  createForm,
  formAttributes,
  getForm,
  previewForm,
  listForms,
  publishForm,
  rotateFormKey,
  saveFormDraft,
  setFormStatus,
} from '@crm/core';
import { withInputFields } from '../../errors.ts';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// Forms (spec 0023, milestone 1), inside a workspace: the door has let in an active member, and `context.scope` is
// theirs. Reads answer the forms on objects the member can see; every change needs forms.manage, checked in the
// service, and goes through `commitWrite`.
export const formsRouter = member.forms.router({
  list: member.forms.list.handler(({ context, input }) => listForms(context.scope, { archived: input.archived })),
  get: member.forms.get.handler(({ context, input }) => getForm(context.scope, { formId: input.formId })),
  attributes: member.forms.attributes.handler(({ context, input }) =>
    formAttributes(context.scope, { formId: input.formId }),
  ),
  preview: member.forms.preview.handler(({ context, input }) => previewForm(context.scope, { formId: input.formId })),
  create: member.forms.create.handler(async ({ context, input }) => {
    try {
      return await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
        createForm(context.scope, { id: input.id, name: input.name, mainObjectId: input.mainObjectId }, hooks),
      );
    } catch (error) {
      throw withInputFields(error, { ID_TAKEN: 'id', CONFIG_INVALID: 'mainObjectId' });
    }
  }),
  saveDraft: member.forms.saveDraft.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      saveFormDraft(
        context.scope,
        {
          formId: input.formId,
          document: input.document,
          expectedRevision: input.expectedRevision,
          ...(input.name === undefined ? {} : { name: input.name }),
        },
        hooks,
      ),
    ),
  ),
  publish: member.forms.publish.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      publishForm(context.scope, { formId: input.formId, expectedRevision: input.expectedRevision }, hooks),
    ),
  ),
  setStatus: member.forms.setStatus.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      setFormStatus(context.scope, { formId: input.formId, status: input.status }, hooks),
    ),
  ),
  rotateKey: member.forms.rotateKey.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      rotateFormKey(context.scope, { formId: input.formId }, hooks),
    ),
  ),
});
