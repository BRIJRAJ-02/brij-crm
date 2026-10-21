import { MAX_CALENDAR_CONNECTIONS } from '@crm/contracts';
import {
  addMeetingAttendee,
  dismissCalendarNotice,
  listCalendarConnections,
  listMemberCalendars,
  readCalendarHealth,
  readPageDestination,
  refreshCalendarConnection,
  setCalendarDestination,
  setPageDestination,
  updateMemberCalendar,
  listMeetingsForRecord,
  readCalendarSettings,
  removeCalendarConnection,
  syncCalendarNow,
  updateCalendarConnection,
  updateCalendarSettings,
} from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member, type RequestContext } from '../../orpc.ts';

/** The door's scope, as the services take it. */
type DoorScope = Parameters<typeof listMemberCalendars>[0];

/** Forgets the acting member's kept free and busy answers (a conflict switch or the destination changed). */
function forget(context: Pick<RequestContext, 'calendarEvents'> & { readonly scope: DoorScope }): void {
  const { principal } = context.scope.access;
  if (principal.kind === 'member') context.calendarEvents?.forget(context.scope.workspaceId, principal.memberId);
}

// Calendar sync (spec 0024), inside a workspace: the door has let in an active member, and `context.scope` is
// theirs. Each member reads and changes only their own connections (another's is NOT_FOUND); connecting is the OAuth
// redirect (`calendar/routes.ts`), not a procedure. A change that touches meetings goes through `commitWrite`, so its
// `meetings` event is stored with it and the worker is woken once it commits. Add as person and the workspace's
// calendar settings (milestone 2) work whether or not sync is switched on here: they touch only what has synced.
// Milestone 5 adds the member's calendars, their switches and where bookings go (own member only, AC-1306), a booking
// page's own destination (through the page), and spec 0037's health read: statuses only, for members in reach.

/** The providers a member may connect here: Google, and Outlook where it is on. */
const providersOf = (calendar: { readonly providers: { readonly microsoft?: unknown } } | undefined) =>
  calendar === undefined
    ? []
    : calendar.providers.microsoft === undefined
      ? (['google'] as const)
      : (['google', 'microsoft'] as const);

export const calendarRouter = member.calendar.router({
  connections: {
    list: member.calendar.connections.list.handler(async ({ context }) => {
      const enabled = context.calendar !== undefined;
      return {
        enabled,
        providers: [...providersOf(context.calendar)],
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
    // Sync now: a write like any other, so its commit (the queued job row) wakes the worker through the hooks.
    syncNow: member.calendar.connections.syncNow.handler(({ context, input }) =>
      commitWrite(context, { mutationId: input.mutationId }, () =>
        syncCalendarNow(context.scope, { connectionId: input.connectionId }),
      ),
    ),
    // Refresh (AC-991): the account's calendars are listed on its next sync, brought forward to now.
    refresh: member.calendar.connections.refresh.handler(({ context, input }) =>
      commitWrite(context, { mutationId: input.mutationId }, () =>
        refreshCalendarConnection(context.scope, { connectionId: input.connectionId }),
      ),
    ),
  },
  calendars: {
    list: member.calendar.calendars.list.handler(async ({ context }) => {
      const { accounts, ...rest } = await listMemberCalendars(context.scope);
      return {
        enabled: context.calendar !== undefined,
        providers: [...providersOf(context.calendar)],
        max: MAX_CALENDAR_CONNECTIONS,
        accounts: [...accounts],
        ...rest,
      };
    }),
    update: member.calendar.calendars.update.handler(async ({ context, input }) => {
      const updated = await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
        updateMemberCalendar(
          context.scope,
          {
            calendarId: input.calendarId,
            ...(input.checkConflicts === undefined ? {} : { checkConflicts: input.checkConflicts }),
            ...(input.showInWeek === undefined ? {} : { showInWeek: input.showInWeek }),
            ...(input.sync === undefined ? {} : { sync: input.sync }),
            ...(input.colourOverride === undefined ? {} : { colourOverride: input.colourOverride }),
          },
          hooks,
        ),
      );
      // A conflict switch changed: this member's kept free and busy answers go (AC-994).
      if (updated.busyChanged) forget(context);
      return updated.calendar;
    }),
  },
  destination: {
    set: member.calendar.destination.set.handler(async ({ context, input }) => {
      const set = await commitWrite(context, { mutationId: input.mutationId }, () =>
        setCalendarDestination(context.scope, { calendarId: input.calendarId }),
      );
      forget(context);
      return set;
    }),
    dismissNotice: member.calendar.destination.dismissNotice.handler(({ context, input }) =>
      commitWrite(context, { mutationId: input.mutationId }, () => dismissCalendarNotice(context.scope)),
    ),
  },
  pageDestination: {
    get: member.calendar.pageDestination.get.handler(({ context, input }) =>
      readPageDestination(context.scope, { pageId: input.pageId }),
    ),
    set: member.calendar.pageDestination.set.handler(({ context, input }) =>
      commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
        setPageDestination(context.scope, { pageId: input.pageId, calendarId: input.calendarId }, hooks),
      ),
    ),
  },
  // Spec 0037 (AC-1307): a status and since when for each asked member in reach; nothing else of their calendars.
  health: member.calendar.health.handler(async ({ context, input }) => ({
    members: [...(await readCalendarHealth(context.scope, { memberIds: input.memberIds }))],
  })),
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
