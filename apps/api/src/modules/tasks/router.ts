import { createTask, getTasks, listTasks, updateTask } from '@crm/core';
import { withInputFields } from '../../errors.ts';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// Tasks (spec 0019), inside a workspace: the door has let in an active member, and `context.scope` is theirs. The
// services apply the task rule and the change rule; each write goes through `commitWrite`, so its `tasks` event is
// stored with it and the worker is woken once it commits.
export const tasksRouter = member.tasks.router({
  get: member.tasks.get.handler(({ context, input }) => getTasks(context.scope, { ids: input.ids })),
  list: member.tasks.list.handler(({ context, input }) =>
    listTasks(context.scope, {
      scope: input.scope,
      status: input.status,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    }),
  ),
  create: member.tasks.create.handler(async ({ context, input }) => {
    try {
      return await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
        createTask(
          context.scope,
          {
            id: input.id,
            title: input.title,
            ...(input.dueOn === undefined ? {} : { dueOn: input.dueOn }),
            ...(input.assigneeMemberId === undefined ? {} : { assigneeMemberId: input.assigneeMemberId }),
            ...(input.recordIds === undefined ? {} : { recordIds: input.recordIds }),
          },
          hooks,
        ),
      );
    } catch (error) {
      throw withInputFields(error, { ID_TAKEN: 'id', LIMIT_REACHED: 'recordIds' });
    }
  }),
  update: member.tasks.update.handler(async ({ context, input }) => {
    try {
      return await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
        updateTask(
          context.scope,
          {
            taskId: input.taskId,
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.dueOn === undefined ? {} : { dueOn: input.dueOn }),
            ...(input.assigneeMemberId === undefined ? {} : { assigneeMemberId: input.assigneeMemberId }),
            ...(input.isDone === undefined ? {} : { isDone: input.isDone }),
            ...(input.addRecordIds === undefined ? {} : { addRecordIds: input.addRecordIds }),
            ...(input.removeRecordIds === undefined ? {} : { removeRecordIds: input.removeRecordIds }),
          },
          hooks,
        ),
      );
    } catch (error) {
      throw withInputFields(error, { LIMIT_REACHED: 'addRecordIds' });
    }
  }),
});
