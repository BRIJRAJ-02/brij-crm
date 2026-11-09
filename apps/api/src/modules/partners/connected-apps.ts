import { disconnectApp, listConnectedApps, setConnectedAppModules } from '@crm/core';
import { member } from '../../orpc.ts';
import { sourceOf } from '../../source.ts';

// Settings › Connected apps (spec 0070, AC-7013), inside a workspace: every call needs `connected_apps.manage`
// (owners only; the services check it first). A connection is who may call the partner API, not CRM data, so these
// writes store no outbox row; each writes its History row in its own transaction. Disconnect stops the token at
// once: the partner door reads `disconnected_at` on every call, and so does the embedded frame's (slice 4).
export const connectedAppsRouter = member.connectedApps.router({
  list: member.connectedApps.list.handler(({ context }) =>
    listConnectedApps(context.scope, { partners: context.partners }),
  ),
  setModules: member.connectedApps.setModules.handler(({ context, input }) =>
    setConnectedAppModules(
      context.scope,
      { partners: context.partners },
      { connectionId: input.connectionId, modules: input.modules },
      sourceOf(context),
    ),
  ),
  disconnect: member.connectedApps.disconnect.handler(async ({ context, input }) => {
    const ended = await disconnectApp(
      context.scope,
      { partners: context.partners },
      { connectionId: input.connectionId },
      sourceOf(context),
    );
    // Every embedded session for it ends too (AC-7013), once the disconnect has committed. The door already refuses
    // them (it reads the connection on every call); this takes their rows away.
    await context.embedSessions.end([ended.id]);
    return ended;
  }),
});
