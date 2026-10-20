import { MAX_CALENDAR_CONNECTIONS } from '@crm/contracts';
import {
  addMeetingAttendee,
  listCalendarConnections,
  listMeetingsForRecord,
  readCalendarSettings,
  removeCalendarConnection,
  updateCalendarConnection,
  updateCalendarSettings,
} from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// Calendar sync (spec 0024), inside a workspace: the door has let in an active member, and `context.scope` is
// theirs. Each member reads and changes only their own connections (another's is NOT_FOUND); connecting is the OAuth
// redirect (`calendar/routes.ts`), not a procedure. A change that touches meetings goes through `commitWrite`, so its
// `meetings` event is stored with it and the worker is woken once it commits. Add as person and the workspace's
// calendar settings (milestone 2) work whether or not sync is switched on here: they touch only what has synced.
export const calendarRouter = member.calendar.router({
  connections: {
    list: member.calendar.connections.list.handler(async ({ context }) => {
      const enabled = context.calendar !== undefined;
      return {
        enabled,
        providers: enabled ? ['google' as const] : [],
        connections: await listCalendarConnections(context.scope),
        max: MAX_CALENDAR_CONNECTIONS,
      };
    }),
    update: member.calendar.connections.update.handler(({ context, input }) =>
      commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
        updateCalendarConnection(
          context.scope,
          {
            connectionId: input.connectionId,
            ...(input.sharing === undefined ? {} : { sharing: input.sharing }),
            ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
          },
          hooks,
        ),
      ),
    ),
    remove: member.calendar.connections.remove.handler(({ context, input }) =>
      commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
        removeCalendarConnection(context.scope, { connectionId: input.connectionId }, hooks),
      ),
    ),
  },
  meetings: {
    forRecord: member.calendar.meetings.forRecord.handler(({ context, input }) =>
      listMeetingsForRecord(context.scope, {
        recordId: input.recordId,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      }),
    ),
    addAttendee: member.calendar.meetings.addAttendee.handler(({ context, input }) =>
      commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
        addMeetingAttendee(
          context.scope,
          { recordId: input.recordId, meetingId: input.meetingId, email: input.email },
          { isFreeDomain: context.isFreeDomain },
          hooks,
        ),
      ),
    ),
  },
  settings: {
    get: member.calendar.settings.get.handler(({ context }) => readCalendarSettings(context.scope)),
    update: member.calendar.settings.update.handler(({ context, input }) =>
      commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
        updateCalendarSettings(context.scope, { createUnknownPeople: input.createUnknownPeople }, hooks),
      ),
    ),
  },
});
