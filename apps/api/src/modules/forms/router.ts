import {
  createForm,
  deleteForm,
  duplicateForm,
  formAttributes,
  getForm,
  isSlugAvailable,
  listForms,
  previewForm,
  publishForm,
  rotateFormSecret,
  saveFormDraft,
  setFormStatus,
  setFormTarget,
  updateFormSettings,
  previewSync,
  startSync,
} from '@crm/core';
import { withInputFields } from '../../errors.ts';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// Forms (spec 0023), inside a workspace: the door has let in an active member, and `context.scope` is theirs. Reads
// answer the forms on objects the member can see; every change needs forms.manage, checked in the service, and goes
// through `commitWrite`.
export const formsRouter = member.forms.router({
  list: member.forms.list.handler(({ context, input }) => listForms(context.scope, { archived: input.archived })),
  get: member.forms.get.handler(({ context, input }) => getForm(context.scope, { formId: input.formId })),
  attributes: member.forms.attributes.handler(({ context, input }) =>
    formAttributes(context.scope, { formId: input.formId }),
  ),
  preview: member.forms.preview.handler(({ context, input }) => previewForm(context.scope, { formId: input.formId })),
  slugAvailable: member.forms.slugAvailable.handler(({ context, input }) =>
    isSlugAvailable(context.scope, { formId: input.formId, slug: input.slug }),
  ),
  create: member.forms.create.handler(async ({ context, input }) => {
    try {
      return await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
        createForm(
          context.scope,
          {
            id: input.id,
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.mainObjectId === undefined ? {} : { mainObjectId: input.mainObjectId }),
            ...(input.starter === undefined ? {} : { starter: input.starter }),
          },
          hooks,
        ),
      );
    } catch (error) {
      throw withInputFields(error, { ID_TAKEN: 'id' });
    }
  }),
  saveDraft: member.forms.saveDraft.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      saveFormDraft(
        context.scope,
        { formId: input.formId, document: input.document, expectedRevision: input.expectedRevision },
        hooks,
        { publicOrigins: context.publicOrigins },
      ),
    ),
  ),
  publish: member.forms.publish.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      publishForm(
        context.scope,
        {
          formId: input.formId,
          expectedRevision: input.expectedRevision,
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.slug === undefined ? {} : { slug: input.slug }),
        },
        hooks,
        { publicOrigins: context.publicOrigins },
      ),
    ),
  ),
  updateSettings: member.forms.updateSettings.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      updateFormSettings(
        context.scope,
        {
          formId: input.formId,
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.slug === undefined ? {} : { slug: input.slug }),
          ...(input.ownerMemberId === undefined ? {} : { ownerMemberId: input.ownerMemberId }),
          ...(input.ownerRotationId === undefined ? {} : { ownerRotationId: input.ownerRotationId }),
          ...(input.allowedOrigins === undefined ? {} : { allowedOrigins: input.allowedOrigins }),
          ...(input.requireSignature === undefined ? {} : { requireSignature: input.requireSignature }),
          ...(input.notifyMemberIds === undefined ? {} : { notifyMemberIds: input.notifyMemberIds }),
        },
        hooks,
      ),
    ),
  ),
  rotateSecret: member.forms.rotateSecret.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      rotateFormSecret(context.scope, { formId: input.formId }, hooks),
    ),
  ),
  setStatus: member.forms.setStatus.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      setFormStatus(context.scope, { formId: input.formId, status: input.status }, hooks),
    ),
  ),
  setTarget: member.forms.setTarget.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      setFormTarget(
        context.scope,
        { formId: input.formId, mainObjectId: input.mainObjectId, expectedRevision: input.expectedRevision },
        hooks,
      ),
    ),
  ),
  duplicate: member.forms.duplicate.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      duplicateForm(context.scope, { formId: input.formId, id: input.id }, hooks),
    ),
  ),
  delete: member.forms.delete.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      deleteForm(context.scope, { formId: input.formId }, hooks),
    ),
  ),
  // Sync old records (spec 0023 follow-up): a read only preview, then the member's `forms.sync` job.
  syncPreview: member.forms.syncPreview.handler(({ context, input }) =>
    previewSync(context.scope, { formId: input.formId, scope: input.scope }),
  ),
  syncStart: member.forms.syncStart.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      startSync(context.scope, context.jobs, { formId: input.formId, scope: input.scope, jobId: input.jobId }, hooks),
    ),
  ),
});
