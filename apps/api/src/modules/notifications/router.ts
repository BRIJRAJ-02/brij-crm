import {
  countUnread,
  getNotificationSettings,
  listNotifications,
  markAllRead,
  markNotifications,
  setNotificationSettings,
} from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// The inbox (spec 0038), inside a workspace: the caller's own notifications and settings only. No procedure takes
// a member id; the services read the member from `context.scope`, and a notification id that isn't theirs answers
// `NOT_FOUND` (AC-1181). Marks and settings go through `commitWrite`, so the member's other tabs hear of them
// through one `notifications` row naming them.
export const notificationsRouter = member.notifications.router({
  list: member.notifications.list.handler(({ context, input }) =>
    listNotifications(context.scope, {
      status: input.status,
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      ...(input.unreadOnly === undefined ? {} : { unreadOnly: input.unreadOnly }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    }),
  ),
  count: member.notifications.count.handler(({ context }) => countUnread(context.scope)),
  mark: member.notifications.mark.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      markNotifications(
        context.scope,
        {
          ids: input.ids,
          ...(input.read === undefined ? {} : { read: input.read }),
          ...(input.done === undefined ? {} : { done: input.done }),
        },
        hooks,
      ),
    ),
  ),
  markAllRead: member.notifications.markAllRead.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      markAllRead(
        context.scope,
        { status: input.status, ...(input.kind === undefined ? {} : { kind: input.kind }) },
        hooks,
      ),
    ),
  ),
  settings: member.notifications.settings.handler(({ context }) => getNotificationSettings(context.scope)),
  setSettings: member.notifications.setSettings.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      setNotificationSettings(
        context.scope,
        {
          ...(input.emailMentions === undefined ? {} : { emailMentions: input.emailMentions }),
          ...(input.emailReplies === undefined ? {} : { emailReplies: input.emailReplies }),
          ...(input.emailAssignments === undefined ? {} : { emailAssignments: input.emailAssignments }),
          ...(input.digest === undefined ? {} : { digest: input.digest }),
          ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
        },
        hooks,
      ),
    ),
  ),
});
